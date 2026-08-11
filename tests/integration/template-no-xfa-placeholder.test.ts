/**
 * Repo guard: no committed form-template page may be an Adobe XFA fallback
 * page. When poppler cannot render dynamic XFA it emits a placeholder ("Please
 * wait…" / "you need a later version of the PDF viewer… upgrade to the latest
 * version of Adobe Reader"), and that placeholder must never be flattened into
 * a template. scripts/flatten-navmc-form.sh refuses it at import time; this
 * test is the second line of defense — it scans every committed page so a
 * placeholder that slips past the script (a new wording, a hand-copied file)
 * fails CI instead of shipping as a blank form.
 *
 * NAVMC 11760 shipped this way once: its placeholder used a wording the
 * original guard's two hard-coded phrases missed.
 *
 * Requires pdftotext; skipped (not falsely passed) without.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const TEMPLATES = join(process.cwd(), 'public/templates');

// Every known Adobe XFA fallback wording points the reader at adobe.com and
// talks about the "PDF viewer" — text no real Marine Corps form body carries.
// Keep in lockstep with $XFA_PLACEHOLDER in scripts/flatten-navmc-form.sh.
const PLACEHOLDER =
  /please wait|may not be able to display|the proper contents of the document|to view the full contents of this document|later version of the (pdf|adobe)|upgrade to the latest version of adobe|www\.adobe\.com|get adobe reader/i;

function templatePages(): string[] {
  const pages: string[] = [];
  for (const dir of readdirSync(TEMPLATES)) {
    const full = join(TEMPLATES, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full)) {
      if (/^page\d+\.pdf$/.test(file)) pages.push(join(full, file));
    }
  }
  return pages;
}

if (!hasPdfToolchain) describeToolchainRequirement('template-no-xfa-placeholder');

describe.runIf(hasPdfToolchain)('committed templates carry no Adobe XFA placeholder', () => {
  const pages = templatePages();

  it('finds template pages to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s renders real form content, not an Adobe fallback', (page) => {
    const text = spawnSync('pdftotext', ['-layout', page, '-'], { encoding: 'utf-8' }).stdout ?? '';
    const match = text.match(PLACEHOLDER);
    expect(
      match,
      `${page} contains Adobe XFA placeholder text ("${match?.[0]}"). This page is a ` +
        `"Please wait / upgrade Adobe Reader" fallback, not the form. Flatten the ` +
        `source in Acrobat (File > Print > Save as PDF) and re-import.`
    ).toBeNull();
  });
});
