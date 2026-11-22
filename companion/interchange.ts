import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { version } from '../package.json';
import {
  createSemanticInterchange, MAX_INTERCHANGE_BYTES, openSemanticInterchange, parseSemanticJson, semanticInterchangeSchema,
} from '../src/lib/semanticInterchange';

async function readJson(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_INTERCHANGE_BYTES) throw new Error('Choose a JSON file no larger than 101 MB.');
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const final = await file.stat();
    if (size !== stat.size || final.size !== stat.size || final.mtimeMs !== stat.mtimeMs || final.ctimeMs !== stat.ctimeMs) throw new Error('The JSON file changed while it was being read.');
    return parseSemanticJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } finally {
    await file.close();
  }
}

async function writeNewFile(path: string, json: string) {
  const file = await open(path, 'wx', 0o600);
  const identity = await file.stat().catch(() => undefined);
  try {
    await file.writeFile(json, 'utf8');
    await file.close();
  } catch (error) {
    await file.close().catch(() => {});
    const current = await lstat(path).catch(() => undefined);
    if (identity && current?.dev === identity.dev && current.ino === identity.ino) {
      await unlink(path).catch(() => {});
    }
    throw error;
  }
}

async function main(args: string[]) {
  const [operation, inputPath, outputPath, assertionsPath] = args;
  if (operation === 'schema' && args.length === 1) {
    console.log(JSON.stringify(semanticInterchangeSchema(), null, 2));
    return;
  }
  if (!inputPath || !outputPath || args.length > 4 || !['pack', 'unpack'].includes(operation) || (operation === 'unpack' && assertionsPath)) {
    throw new Error('Usage: interchange schema | pack INPUT OUTPUT [AUTHOR_ASSERTIONS] | unpack INPUT OUTPUT');
  }
  const input = await readJson(inputPath);
  const result = operation === 'pack'
    ? await createSemanticInterchange(input, version, assertionsPath ? await readJson(assertionsPath) : undefined)
    : (await openSemanticInterchange(input)).payload;
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) > MAX_INTERCHANGE_BYTES) throw new Error('The output exceeds the 101 MB transfer limit.');
  await writeNewFile(outputPath, json);
}

try {
  await main(process.argv.slice(2));
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Interchange failed.');
  process.exitCode = 1;
}
