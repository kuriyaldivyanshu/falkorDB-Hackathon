import { Pool } from 'pg';
import { loadLocalEnvironment } from './environment.js';
import { parseBackendConfig } from './config.js';

/** Provision a non-owner app role without changing passwords of existing roles. */
async function setup():Promise<void> {
 const config=parseBackendConfig(loadLocalEnvironment()).storage.postgres;
 if(!/^[a-z_][a-z0-9_]{0,62}$/.test(config.user) || config.user===config.migrationUser)
  throw new Error('Configure separate plain lower-case PostgreSQL application and migration role names.');
 const owner=new Pool({host:config.host,port:config.port,database:config.database,user:config.migrationUser,password:config.migrationPassword,connectionTimeoutMillis:5000});
 try {
  const roles=await owner.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1',[config.user]);
  if(!roles.rows[0]) {
   const statement=await owner.query<{statement:string}>("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L',$1::text,$2::text) AS statement",[config.user,config.password]);
   await owner.query(statement.rows[0]!.statement);
  } else if(roles.rows[0].rolsuper || roles.rows[0].rolbypassrls) throw new Error('The application role bypasses RLS; select a separate restricted role.');
  const app=new Pool({host:config.host,port:config.port,database:config.database,user:config.user,password:config.password,connectionTimeoutMillis:5000});
  try { await app.query('SELECT 1'); } finally { await app.end(); }
  process.stdout.write('Application role is reachable and cannot bypass RLS. Start the backend to apply versioned migrations.\n');
 } finally { await owner.end(); }
}
setup().catch(()=>{process.stderr.write('Database setup failed. Check local ports and app/owner credentials. Existing volumes retain their original PostgreSQL owner/password; editing .env does not reset them. No credentials were printed or reset.\n');process.exitCode=1;});
