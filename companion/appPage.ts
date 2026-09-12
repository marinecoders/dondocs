/**
 * The page a host that renders MCP Apps shows in place of the render result:
 * the letter as a card, with a preview and a download button.
 *
 * It is built, not written: `vite.companion-app.config.ts` bundles
 * `companion/app/letter.ts` with the App bridge and pdf.js into one HTML file
 * at `dist-companion/companion/app/letter.html`, beside the built entry. A
 * source run has no such file and offers no page; the tools work the same.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const APP_URI = 'ui://dondocs/letter.html';

/** The built page, or undefined when this is a source run. */
export function loadAppPage(): string | undefined {
  const path = join(HERE, 'app', 'letter.html');
  return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
}
