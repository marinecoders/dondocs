import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { loadPackageFormDefinition, packageFormFields } from '@/lib/packageFormFields';

it('rejects a changed mapping, retries, and resolves only fields from the requested edition', async () => {
  const edition = { id: 'navmc10132', edition: '2023-08' };
  const profile = officialEdition(edition.id, edition.edition)!;
  const published = JSON.parse(await readFile('public/templates/' + profile.directory + '/form.json', 'utf8'));
  const changed = structuredClone(published);
  changed.fields['17_unit'].sourceIds = published.fields['18_accused_full_name'].sourceIds;
  const fetchFile = vi.fn().mockResolvedValueOnce(Response.json(changed)).mockResolvedValueOnce(Response.json(published));
  vi.stubGlobal('fetch', fetchFile);
  try {
    await expect(packageFormFields(edition)).rejects.toThrow('does not match');
    const field = await packageFormFields(edition);
    const editorCopy = await loadPackageFormDefinition(profile);
    editorCopy.fields['17_unit'].sourceIds = [];
    expect(field('17_unit')).toBe('17 UNIT');
    expect(field('2_acc_election_and_rights_signature')).toBe('2 ACC ELECTION AND RIGHTS SIGNATURE');
    expect(() => field('missing_field')).toThrow('missing_field');
    expect(() => field('constructor')).toThrow('constructor');
    await expect(packageFormFields({ ...edition, edition: 'unknown' })).rejects.toThrow('unavailable');
    expect(fetchFile).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
