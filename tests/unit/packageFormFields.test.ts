import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { loadPackageFormDefinition, packageFormFields } from '@/lib/packageFormFields';

it('rejects a changed mapping, retries, and resolves only fields from the requested edition', async () => {
  const edition = { id: 'dd0368', edition: '2011-08.upd20241126' };
  const profile = officialEdition(edition.id, edition.edition)!;
  const published = JSON.parse(await readFile('public/templates/' + profile.directory + '/form.json', 'utf8'));
  const changed = structuredClone(published);
  changed.fields.valid_until.sourceIds = published.fields.member_name.sourceIds;
  const fetchFile = vi.fn().mockResolvedValueOnce(Response.json(changed)).mockResolvedValueOnce(Response.json(published));
  vi.stubGlobal('fetch', fetchFile);
  try {
    await expect(packageFormFields(edition)).rejects.toThrow('does not match');
    const field = await packageFormFields(edition);
    const editorCopy = await loadPackageFormDefinition(profile);
    editorCopy.fields.valid_until.sourceIds = [];
    expect(field('valid_until')).toBe('form1[0].#subform[0].TextField2[18]');
    expect(field('member_signature')).toBe('form1[0].#subform[0].member[0]');
    expect(() => field('missing_field')).toThrow('missing_field');
    expect(() => field('constructor')).toThrow('constructor');
    await expect(packageFormFields({ ...edition, edition: 'unknown' })).rejects.toThrow('unavailable');
    expect(fetchFile).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
