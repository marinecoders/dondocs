/**
 * The page a host that renders MCP Apps shows in place of the render result:
 * the letter as a card, with a preview and a download button.
 *
 * It is built, not written: `vite.companion-app.config.ts` bundles
 * `companion/app/letter.ts` with the App bridge and pdf.js into one HTML file
 * at `dist-companion/companion/app/letter.html`, beside the built entry. A
 * source run has no such file and offers no page; the tools work the same.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface AppPage {
  /**
   * `ui://dondocs/letter.<hash>.html`, the hash being the page's own: a
   * host may keep a page it has read by its URI, so a changed page is a
   * changed name.
   */
  uri: string;
  html: string;
}

/** The built page beside the entry, or undefined when this is a source run. */
export function loadAppPage(): AppPage | undefined {
  const path = join(HERE, 'app', 'letter.html');
  if (!existsSync(path)) { return undefined; }
  const html = readFileSync(path, 'utf-8');
  return { uri: `ui://dondocs/letter.${createHash('sha256').update(html).digest('hex').slice(0, 8)}.html`, html };
}
