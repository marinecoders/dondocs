import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { idbReadHandoffs, idbUpdateHandoffs } from '@/lib/documentsDb';
import { comparePackageHandoffs, listPackageHandoffs, rememberPackageHandoff, type PackageHandoff } from '@/lib/packageHandoffHistory';

it('keeps same-revision selections and compares identity, original bytes and relative order', async () => {
  const packageId = crypto.randomUUID();
  const member = (id: string, sha256 = id) => ({ id, label: 'Same form', role: 'enclosure', files: [{ name: 'Form.pdf', sha256: sha256 === 'replacement' ? '0'.repeat(64) : sha256.repeat(64) }] });
  const first: PackageHandoff = { id: 'first', packageId, revisionId: 'same', label: 'Copy', createdAt: 1, purpose: 'recipient',
    members: [member('a'), member('b'), member('c')] };
  const second = { ...first, id: 'second', members: [member('c'), member('d'), member('a', 'replacement')] };
  await Promise.all([rememberPackageHandoff(first), rememberPackageHandoff(second)]);
  expect((await listPackageHandoffs(packageId)).map(item => item.id).sort()).toEqual(['first', 'second']);
  expect(comparePackageHandoffs(first, second).map(item => [item.id, item.status])).toEqual([
    ['c', 'Order changed'], ['d', 'Added'], ['a', 'Files changed · Order changed'], ['b', 'Removed'],
  ]);
  expect(await listPackageHandoffs('unrelated')).toEqual([]);
});

it('keeps the exact full output checksum and rejects invalid receipt content', async () => {
  const packageId = crypto.randomUUID();
  const value: PackageHandoff = { packageId, revisionId: 'r1', id: 'a', createdAt: 1, label: 'Example', purpose: 'pdf', members: [],
    output: { name: 'Example.pdf', sha256: 'a'.repeat(64) } };
  await rememberPackageHandoff(value);
  expect(await listPackageHandoffs(packageId)).toEqual([value]);
  expect(() => rememberPackageHandoff({ ...value, output: { name: 'Bad.pdf', sha256: 'unknown' } })).toThrow();
});

it('preserves damaged local history and never displays another package’s records', async () => {
  const packageId = crypto.randomUUID();
  const value: PackageHandoff = { id: 'r1', packageId, revisionId: 'a', purpose: 'pdf', createdAt: 1, label: 'Synthetic', members: [] };
  const foreign = [{ ...value, packageId: 'different-case' }];
  await idbUpdateHandoffs(packageId, () => foreign);
  await expect(listPackageHandoffs(packageId)).rejects.toThrow('does not match this package');
  await expect(rememberPackageHandoff(value)).rejects.toThrow('does not match this package');
  expect(await idbReadHandoffs(packageId)).toEqual(foreign);
});
