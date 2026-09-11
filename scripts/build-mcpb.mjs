/**
 * Stage the built companion as an MCP Bundle and pack it.
 *
 *   npm run build:companion && node scripts/build-mcpb.mjs
 *
 * The bundle is `dist-companion/` plus the manifest, the icon and a README,
 * so `${__dirname}/companion/mcp.mjs` in the manifest is the same file the
 * asset resolver was tested against. Writes `dist-mcpb/dondocs-<version>.mcpb`
 * and its SHA-256 beside it.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = join(ROOT, 'dist-companion');
const OUT = join(ROOT, 'dist-mcpb');
const STAGE = join(OUT, 'stage');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

if (!existsSync(join(BUILT, 'companion', 'mcp.mjs'))) {
  console.error('dist-companion/ is missing; run `npm run build:companion` first');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const dir of ['companion', 'lib', 'attachments']) { cpSync(join(BUILT, dir), join(STAGE, dir), { recursive: true }); }
// The PNG is generated from public/icon.svg by the web build's prebuild step
// and is not in git; make it here when it is missing.
const ICON = join(ROOT, 'public', 'pwa-512.png');
if (!existsSync(ICON)) { execFileSync(process.execPath, [join(ROOT, 'scripts', 'generate-icons.mjs')], { stdio: 'inherit' }); }
cpSync(ICON, join(STAGE, 'icon.png'));
cpSync(join(ROOT, 'companion', 'mcpb', 'README.md'), join(STAGE, 'README.md'));

const manifest = JSON.parse(readFileSync(join(ROOT, 'companion', 'mcpb', 'manifest.json'), 'utf-8'));
manifest.version = version;
writeFileSync(join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const mcpb = join(OUT, `dondocs-${version}.mcpb`);
execFileSync('npx', ['--yes', '@anthropic-ai/mcpb@2.1.2', 'validate', join(STAGE, 'manifest.json')], { stdio: 'inherit' });
execFileSync('npx', ['--yes', '@anthropic-ai/mcpb@2.1.2', 'pack', STAGE, mcpb], { stdio: 'inherit' });
const sha = createHash('sha256').update(readFileSync(mcpb)).digest('hex');
writeFileSync(`${mcpb}.sha256`, `${sha}  ${basename(mcpb)}\n`);
console.log(`${mcpb}\nsha256 ${sha}`);
