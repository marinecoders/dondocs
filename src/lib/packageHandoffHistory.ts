import { z } from 'zod';
import { idbUpdateHandoffs, idbReadHandoffs } from './documentsDb';
import { packageDocumentName, type PackageRevision } from './actionPackages';

const identity = z.string().min(1).max(100);
const file = z.object({ name: z.string().min(1).max(255), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const member = z.object({
  id: identity, label: z.string().min(1).max(160), role: z.string().min(1).max(100), revisionId: identity.optional(), files: z.array(file).max(600),
}).strict();
const receipt = z.object({
  id: identity, packageId: identity, revisionId: identity, label: z.string().min(1).max(255), createdAt: z.number().int().nonnegative(),
  purpose: z.enum(['recipient', 'editable', 'pdf', 'draft-pdf']), members: z.array(member).max(100),
  output: file.optional(),
}).strict().refine(value => new Set(value.members.map(item => item.id)).size === value.members.length, 'Duplicate document in history.');
export type PackageHandoff = z.infer<typeof receipt>;
export const handoffPurpose = { recipient: 'Recipient files', editable: 'Editable handoff', pdf: 'Reading PDF', 'draft-pdf': 'Draft PDF' };

function decodeHistory(packageId: string, input: unknown) {
  const rows = z.array(receipt).max(20).parse(input);
  if (rows.some(row => row.packageId !== packageId) || new Set(rows.map(row => row.id)).size !== rows.length)
    throw new Error('The stored history does not match this package.');
  return rows;
}

export async function listPackageHandoffs(packageId: string) {
  return decodeHistory(packageId, await idbReadHandoffs(packageId));
}

export function rememberPackageHandoff(value: PackageHandoff) {
  const next = receipt.parse(value);
  return idbUpdateHandoffs(next.packageId, stored => [
    next, ...decodeHistory(next.packageId, stored).filter(item => item.id !== next.id),
  ].slice(0, 20));
}

export function documentHandoffMembers(revision: PackageRevision, withSources: boolean, ids?: readonly string[]) {
  const candidates = new Map(revision.members.map(item => [item.id, item]));
  return (ids ?? [...candidates.keys()]).map(id => {
    const item = candidates.get(id);
    if (!item) throw new Error('The output refers to a document outside the selected revision.');
    const assets = !withSources ? [] : item.kind === 'native' ? [item.draft, ...Object.values(item.templates ?? {})]
      : [item.original, ...(item.kind === 'original' && item.printableCopy ? [item.printableCopy.asset] : [])];
    return { id, label: packageDocumentName(revision, item), role: item.role, revisionId: item.revisionId,
      files: assets.map(({ name, sha256 }) => ({ name, sha256 })) };
  });
}

export function comparePackageHandoffs(before: PackageHandoff, after: PackageHandoff) {
  if (before.packageId !== after.packageId) throw new Error('Choose two deliveries from the same package.');
  const previous = new Map(before.members.map(item => [item.id, item]));
  const current = new Set(after.members.map(item => item.id));
  const retained = new Map(before.members.filter(item => current.has(item.id)).map((item, index) => [item.id, index]));
  let nextIndex = 0;
  return [
    ...after.members.map(item => {
      const prior = previous.get(item.id);
      const changes: string[] = [];
      if (!prior) changes.push('Added');
      else {
        if (JSON.stringify(prior.files) !== JSON.stringify(item.files)) changes.push('Files changed');
        else if (prior.revisionId && item.revisionId && prior.revisionId !== item.revisionId) changes.push('Document revision changed');
        if (prior.role !== item.role || prior.label !== item.label) changes.push('Details changed');
        if (retained.get(item.id) !== nextIndex++) changes.push('Order changed');
      }
      return { id: item.id, label: item.label, status: changes.join(' · ') || 'Unchanged' };
    }),
    ...before.members.filter(item => !current.has(item.id)).map(item => ({ id: item.id, label: item.label, status: 'Removed' })),
  ];
}
