import { readFile } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const ENTRY_POINTS = [
  'src/services/docx/publication/index.ts',
  'src/services/exports/correspondence.ts',
  'tests/_helpers/publicationWordQualification.ts',
  'scripts/generate-publication-word.mts',
  'scripts/verify-publication-word.mts',
  'scripts/qualify-publication-word.mts',
  'vitest.config.ts',
];
const STATIC_INPUTS = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'public/attachments/usmc-seal.png'];
export interface PublicationWordSourceDigest { path: string; sha256: string }

function runtimeImports(file: string, source: string): string[] {
  const imports: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const add = (specifier: ts.Expression | undefined) => { if (specifier && ts.isStringLiteralLike(specifier)) imports.push(specifier.text); };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      const typeOnly = clause?.isTypeOnly || !clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
      if (!typeOnly) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      const bindings = node.exportClause;
      const typeOnly = node.isTypeOnly || bindings && ts.isNamedExports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
      if (!typeOnly) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
}

/** Resolve the actual local module graph, including re-exports and literal
 * dynamic imports. Package/config receipts bind external dependency versions;
 * explicit resources cover files which are loaded rather than imported.
 * Erased type-only edges cannot affect the renderer and are not followed.
 */
export async function localModuleInputs(root: string, entries: readonly string[]): Promise<string[]> {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.app.json'), ts.sys.readFile);
  if (config.error) throw new Error('The publication qualification TypeScript configuration cannot be read.');
  const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root);
  if (converted.errors.length) throw new Error('The publication qualification TypeScript configuration is invalid.');
  const options = { ...converted.options, baseUrl: root, resolveJsonModule: true };
  const files = new Set<string>();
  const pending = entries.map(path => resolve(root, path));
  while (pending.length) {
    const file = pending.pop()!;
    const path = relative(root, file).split(sep).join('/');
    if (path.startsWith('../') || path === '..') throw new Error('Publication qualification inputs must stay inside the repository.');
    if (files.has(path)) continue;
    files.add(path);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    for (const imported of runtimeImports(file, source)) {
      const resolved = ts.resolveModuleName(imported, file, options, ts.sys).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport) pending.push(resolved.resolvedFileName);
      else if (!resolved && (imported.startsWith('.') || imported.startsWith('@/'))) {
        const resource = imported.replace(/\?(?:raw|url)$/, '');
        const asset = imported.startsWith('@/') ? resolve(root, 'src', resource.slice(2)) : resolve(dirname(file), resource);
        if (!ts.sys.fileExists(asset)) throw new Error(`${path}: publication qualification cannot resolve ${imported}.`);
        pending.push(asset);
      }
    }
  }
  return [...files].sort();
}

export async function publicationWordInputPaths(assets: readonly string[] = [], root = process.cwd()): Promise<string[]> {
  return [...new Set([...await localModuleInputs(root, ENTRY_POINTS), ...STATIC_INPUTS, ...assets])].sort();
}

export async function publicationWordSourceDigests(paths: readonly string[], root = process.cwd()): Promise<PublicationWordSourceDigest[]> {
  return Promise.all(paths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') })));
}

export async function verifyPublicationWordSources(sources: readonly PublicationWordSourceDigest[], required: readonly string[], root = process.cwd()): Promise<void> {
  const retained = new Map(sources.map(source => [source.path, source.sha256]));
  if (retained.size !== sources.length || retained.size !== required.length || required.some(path => !retained.has(path))) {
    throw new Error('The publication renderer source inventory is incomplete or changed. Regenerate its qualification inputs.');
  }
  for (const current of await publicationWordSourceDigests(required, root)) {
    if (current.sha256 !== retained.get(current.path)) throw new Error(`${current.path}: renderer changed since qualification generation.`);
  }
}
