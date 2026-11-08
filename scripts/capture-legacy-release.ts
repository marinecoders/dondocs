import ts from 'typescript';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { files } from './release-artifact.mjs';

/** Read Workbox's static manifest; never execute a downloaded worker. */
export function legacyWorkerUrls(source: string): string[] {
  const urls = new Set<string>();
  const ast = ts.createSourceFile('sw.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'precacheAndRoute') {
      const entries = node.arguments[0];
      if (entries && ts.isArrayLiteralExpression(entries)) for (const entry of entries.elements) {
        if (ts.isObjectLiteralExpression(entry)) for (const property of entry.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText(ast).replaceAll(/['"]/g, '') === 'url' && ts.isStringLiteral(property.initializer)) urls.add(property.initializer.text);
        }
      }
    }
    if (ts.isStringLiteral(node) && /^\.?\/?workbox-[a-f0-9]+(?:\.js)?$/.test(node.text)) urls.add(node.text.endsWith('.js') ? node.text : `${node.text}.js`);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'importScripts') {
      for (const arg of node.arguments) if (ts.isStringLiteral(arg)) urls.add(arg.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!urls.size) throw new Error('Unsupported legacy worker: supply a complete previous deployment archive');
  return [...urls];
}

export async function captureLegacyRelease(origin: string, output: string, publicRoot = 'public') {
  const base = new URL(origin);
  if (base.protocol !== 'https:') throw new Error('Legacy capture requires the production HTTPS origin');
  const get = async (path: string) => {
    const url = new URL(path, base.origin + '/');
    if (url.origin !== base.origin) throw new Error('Legacy resource is cross-origin');
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.headers.get('Content-Type')?.includes('text/html') && url.pathname !== '/') throw new Error(`Legacy resource unavailable: ${url.pathname}`);
    return { url, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const html = await get('/'), worker = await get('/sw.js');
  if (html.bytes.includes('name="dondocs-release"')) throw new Error('Production already has managed releases; restore its deployment archive');
  await mkdir(output);
  const urls = new Set(['/sw.js', ...legacyWorkerUrls(worker.bytes.toString()),
    ...(await files(publicRoot)).filter(file => !file.startsWith('_') && file !== '404.html').map(file => '/' + file.split('/').map(encodeURIComponent).join('/'))]);
  await writeFile(resolve(output, 'index.html'), html.bytes);
  for (const path of urls) {
    const { url, bytes } = await get(path);
    const target = resolve(output, '.' + decodeURIComponent(url.pathname));
    if (!target.startsWith(resolve(output) + sep)) throw new Error('Legacy asset escapes the capture directory');
    await mkdir(dirname(target), { recursive: true });
    let previous: Buffer | undefined;
    try { previous = await readFile(target); } catch { /* First URL for this file. */ }
    if (previous && !previous.equals(bytes)) throw new Error('Legacy capture returned conflicting bytes');
    await writeFile(target, bytes);
  }
  if (!(await get('/')).bytes.equals(html.bytes) || !(await get('/sw.js')).bytes.equals(worker.bytes)) throw new Error('Production changed during capture; retry with competing publishers disabled');
}
