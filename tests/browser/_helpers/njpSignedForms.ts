import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import type { ActionPackage } from '../../../src/lib/actionPackages';
import type { PortableResourceManifest } from '../../../src/lib/portableResources';
import inspections from '../../fixtures/njp-appeal/inspections.json' with { type: 'json' };

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// Reconstitute public test signatures from the maintained PDFs. The browser's companion
// transport replays an inspection only for the exact bytes verified for that fixture.
export async function receiveSignedAppealForms(exported: Buffer, page: Page) {
  const packet: { package: ActionPackage; portableResources: PortableResourceManifest } = JSON.parse(exported.toString());
  const [revision] = packet.package.revisions;
  const entries = packet.portableResources.entries;
  const retiredDrafts = new Set<string>();
  const saved = new Map<string, Buffer>();
  for (const [key, report] of Object.entries(inspections)) {
    const base = await readFile('public/templates/' + report.original);
    const increment = await readFile('tests/fixtures/njp-appeal/' + key + '.increment.gz');
    const bytes = Buffer.concat([base, gunzipSync(increment)]);
    expect(sha256(bytes)).toBe(report.sha256);
    const index = revision.members.findIndex(m => m.kind === 'native' && m.session.formType === report.formId);
    const member = revision.members[index];
    if (member?.kind !== 'native') throw new Error('Missing test form: ' + report.formId);
    retiredDrafts.add('assets/' + member.draft.id);
    const original = { id: 'signed-' + key, name: key + '.pdf', type: 'application/pdf', size: bytes.length, sha256: report.sha256 };
    entries.push({ path: 'assets/' + original.id, name: original.name, mediaType: original.type, size: original.size,
      sha256: original.sha256, data: bytes.toString('base64') });
    revision.members[index] = { kind: 'original', id: member.id, revisionId: 'signed-' + member.revisionId,
      label: member.label, role: member.role, required: member.required, signedOriginal: true, officialFormId: report.formId, original };
    saved.set(report.formId, bytes);
  }
  packet.portableResources.entries = entries.filter(entry => !retiredDrafts.has(entry.path));
  const confirmed = revision.requirements?.items.find(rule => rule.kind === 'confirmation' && rule.definitionId === 'appeal-enclosures');
  if (confirmed?.kind !== 'confirmation') throw new Error('Missing appeal-enclosures confirmation.');
  confirmed.confirmed = true;
  await page.route('http://127.0.0.1:47993/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/session') return route.fulfill({ json: { token: 'training'.repeat(5), expiresIn: 600, maxAgeSeconds: 900 } });
    if (path === '/identities') return route.fulfill({ json: [] });
    const digest = sha256(route.request().postDataBuffer() ?? Buffer.alloc(0));
    const report = Object.values(inspections).find(item => item.sha256 === digest);
    if (path !== '/inspect' || !report) return route.fulfill({ status: 422 });
    return route.fulfill({ json: report });
  });
  return { packet: Buffer.from(JSON.stringify(packet)), signedForms: saved };
}
