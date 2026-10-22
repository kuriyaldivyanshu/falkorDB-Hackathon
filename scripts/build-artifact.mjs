import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist/npm');
const internalImports = new Map([
  ['@threadline/backend', '#threadline/backend'],
  ['@threadline/shared', '#threadline/shared'],
]);

// All inputs and generated destinations are bounded to this module's checkout.
async function assertRegularPath(path, directory = false) {
  let current = root;
  for (const part of relative(root, path).split('/').filter(Boolean)) {
    current = join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Artifact input must not be a symlink: ${relative(root, current)}`);
  }
  const entry = await lstat(path);
  if (directory ? !entry.isDirectory() : !entry.isFile()) {
    throw new Error(`Artifact input has the wrong type: ${relative(root, path)}`);
  }
}

async function manifest(path) {
  await assertRegularPath(path);
  return JSON.parse(await readFile(path, 'utf8'));
}

// Parse emitted JavaScript so module strings alone are rewritten, never data.
function rewriteModules(source, name, program) {
  const parsed = program.getSourceFile(join(root, name));
  if (!parsed || parsed.text !== source) throw new Error(`Cannot parse compiled JavaScript: ${name}`);
  const edits = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteral(specifier)) {
      const replacement = internalImports.get(specifier.text);
      if (replacement) edits.push([specifier.getStart(parsed), specifier.end, JSON.stringify(replacement)]);
      else if (specifier.text.startsWith('@threadline/')) throw new Error(`Unresolved internal import in ${name}`);
    }
    node.forEachChild(visit);
  }
  visit(parsed);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + value + source.slice(end);
  }
  return source.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '\n');
}

async function collectRuntime(source, target, files) {
  await assertRegularPath(source, true);
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const input = join(source, entry.name);
    const destination = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Artifact input must not be a symlink: ${relative(root, input)}`);
    if (entry.isDirectory()) await collectRuntime(input, destination, files);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push({ input, destination, source: await readFile(input, 'utf8') });
    } else if (!entry.isFile()) throw new Error(`Unsupported artifact input: ${relative(root, input)}`);
  }
}

const metadata = await manifest(join(root, 'package.json'));
const dependencies = {};
for (const workspace of ['cli', 'backend', 'shared']) {
  const data = await manifest(join(root, 'packages', workspace, 'package.json'));
  for (const [name, version] of Object.entries(data.dependencies ?? {})) {
    if (name.startsWith('@threadline/')) {
      if (!internalImports.has(name)) throw new Error(`Unknown internal dependency: ${name}`);
      continue;
    }
    if (/^(?:workspace:|file:|link:)/.test(version)) throw new Error(`Non-portable runtime dependency: ${name}`);
    if (dependencies[name] !== undefined && dependencies[name] !== version) throw new Error(`Conflicting runtime dependency: ${name}`);
    dependencies[name] = version;
  }
}
const asset = join(root, 'assets/codex/compatibility.json');
await assertRegularPath(asset);
for (const entry of ['packages/cli/dist/index.js', 'packages/backend/dist/src/index.js', 'packages/shared/dist/index.js']) {
  await assertRegularPath(join(root, entry));
}
await mkdir(join(root, 'dist'), { recursive: true });
await assertRegularPath(join(root, 'dist'), true);
try {
  await assertRegularPath(output, true);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const staging = await mkdtemp(join(root, 'dist/.npm-'));
let parser;
try {
  const files = [];
  for (const [name, source] of [['cli', 'packages/cli/dist'], ['backend', 'packages/backend/dist/src'], ['shared', 'packages/shared/dist']]) {
    await collectRuntime(join(root, source), join(staging, 'dist', name), files);
  }
  // TypeScript 7 exposes parsing through its build-only API. An in-memory,
  // no-resolution project confines it to the validated compiled files above.
  const configPath = join(root, 'dist/.artifact-parser.json');
  const parserFiles = new Map(files.map(({ input, source }) => [input, source]));
  parserFiles.set(configPath, JSON.stringify({
    compilerOptions: { allowJs: true, noEmit: true, noResolve: true, noLib: true, types: [] },
    files: files.map(({ input }) => input),
  }));
  parser = new API({ cwd: root, fs: {
    fileExists: (path) => parserFiles.has(path),
    readFile: (path) => parserFiles.get(path) ?? null,
  } });
  const snapshot = parser.updateSnapshot({ openProjects: [configPath] });
  const program = snapshot.getProject(configPath)?.program;
  if (!program || program.getSyntacticDiagnostics().length !== 0) throw new Error('Cannot parse compiled runtime modules.');
  for (const { input, destination, source } of files) {
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, rewriteModules(source, relative(root, input), program));
  }
  await mkdir(join(staging, 'assets/codex'), { recursive: true });
  await writeFile(join(staging, 'assets/codex/compatibility.json'), await readFile(asset));
  await writeFile(join(staging, 'package.json'), `${JSON.stringify({
    name: metadata.name, version: metadata.version, private: true, license: metadata.license,
    type: 'module', engines: { node: metadata.engines.node },
    bin: { threadline: './dist/cli/index.js' },
    imports: { '#threadline/backend': './dist/backend/index.js', '#threadline/shared': './dist/shared/index.js' },
    files: ['dist/cli', 'dist/backend', 'dist/shared', 'assets/codex/compatibility.json'],
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2)}\n`);
  await chmod(join(staging, 'dist/cli/index.js'), 0o755);
  // Staging is complete. Assembly failures before this point leave the previous
  // artifact intact; a failure during replacement can leave none until the next
  // successful build regenerates it.
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`Assembled standalone artifact at ${relative(root, output)}`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
} finally {
  parser?.close();
}
