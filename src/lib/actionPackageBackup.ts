import { actionPackageSchema, commitActionPackage, listActionPackages, packageAssets, type ActionPackage } from './actionPackages';
import { readPackageAsset } from './actionPackageAssets';
import { validateActionPackageResources } from './actionPackageTransfer';

/** Recovery carries complete retained history; source IDs remain provenance on the receiving workspace. */
export function packageRecoveryRecord(input: ActionPackage): ActionPackage {
  const record = actionPackageSchema.parse(structuredClone(input));
  delete record.workingCopies;
  for (const revision of record.revisions) for (const member of revision.members) if (member.kind === 'native' && member.source) member.source.local = false;
  return record;
}
export async function capturePackageBackup(): Promise<ActionPackage[]> {
  const records = await listActionPackages();
  for (const record of records) await validateActionPackageResources(record, readPackageAsset);
  return records.map(packageRecoveryRecord);
}
export async function validatePackageBackup(value: unknown, decoded: Map<string, ArrayBuffer>): Promise<ActionPackage[]> {
  if (!Array.isArray(value)) throw new Error('Invalid package recovery inventory.');
  const records = value.map(value => actionPackageSchema.parse(value));
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Duplicate package recovery identity.');
  for (const record of records) await validateActionPackageResources(record, async asset => {
    const bytes = decoded.get(asset.id);
    if (!bytes) throw new Error(`Package recovery is missing ${asset.name}.`);
    return bytes;
  });
  return records.map(packageRecoveryRecord);
}
export async function restorePackageBackup(records: ActionPackage[]): Promise<number> {
  const existing = await listActionPackages();
  for (const record of records) {
    const local = existing.find(local => local.id === record.id);
    if (local && JSON.stringify(packageRecoveryRecord(local)) !== JSON.stringify(record)) throw new Error(`Package ${record.name} has different local history. Local revisions were preserved; keep the backup file.`);
    for (const asset of packageAssets(record)) await readPackageAsset(asset);
  }
  let restored = 0;
  for (const record of records) if (!existing.some(local => local.id === record.id)) { await commitActionPackage(null, record);restored++; }
  return restored;
}
