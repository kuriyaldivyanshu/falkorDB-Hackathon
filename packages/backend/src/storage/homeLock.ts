import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve, parse, relative } from 'node:path';
import { createRequire } from 'node:module';
import { ThreadlineError } from '@threadline/shared';

interface NativeLocks { tryLock(fd:number):boolean; unlock(fd:number):void }
export interface HomeLock { release():void }
/** Keep this inode and descriptor until all admitted work has quiesced. Never
 * unlink it: replacing the inode would let another process acquire a new lock. */
export function acquireHomeLock(home:string):HomeLock {
  let fd:number|undefined;
  try {
    if(process.platform!=='darwin' && process.platform!=='linux') throw new Error('Unsupported lock platform');
    const native=createRequire(import.meta.url)('fs-native-extensions') as NativeLocks;
    home=resolve(home);
    // Inspect every existing path component before creating or opening anything
    // in the home. O_NOFOLLOW alone protects only the final inode.
    let anchor=parse(home).root;
    for(const component of relative(anchor,home).split('/').filter(Boolean)) {
      anchor=join(anchor,component);
      try {if(lstatSync(anchor).isSymbolicLink())throw new Error('Symlink home');}
      catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    mkdirSync(home,{recursive:true,mode:0o700});
    const directory=lstatSync(home);
    if(!directory.isDirectory() || directory.uid!==process.getuid?.() || (directory.mode&0o077)!==0)throw new Error('Unsafe home');
    const path=join(home,'.backend.lock');
    let created:number|undefined;
    let createdIdentity:{dev:number;ino:number}|undefined;
    try {created=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);}
    catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    if(created!==undefined) {
      try {
        const identity=fstatSync(created);
        createdIdentity={dev:identity.dev,ino:identity.ino};
        fsyncSync(created);
      } finally {closeSync(created);}
      const directoryFd=openSync(home,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
      try {fsyncSync(directoryFd);} finally {closeSync(directoryFd);}
    }
    // Lock a fresh description of the durable retained inode. A descriptor
    // returned by creation is not a qualified lock handle on every filesystem.
    fd=openSync(path,constants.O_RDWR|constants.O_NOFOLLOW);
    const stat=fstatSync(fd);
    const named=lstatSync(path);
    if(createdIdentity && (stat.dev!==createdIdentity.dev || stat.ino!==createdIdentity.ino))throw new Error('Created lock inode changed');
    if(named.dev!==stat.dev || named.ino!==stat.ino)throw new Error('Lock inode changed');
    if(!stat.isFile() || stat.nlink!==1 || stat.uid!==process.getuid?.() || (stat.mode&0o077)!==0 || !native.tryLock(fd)) throw new Error('Home ownership unavailable');
    const owned=fd;fd=undefined;let released=false;
    return {release() {if(released)return;released=true;try{native.unlock(owned);}finally{closeSync(owned);}}};
  } catch {
    if(fd!==undefined)closeSync(fd);
    throw new ThreadlineError('storage_unavailable','Exclusive native home ownership is unavailable.');
  }
}
