import type { ActionPackage, PackageMember } from './actionPackages';

export interface MemberRevisionSource {
  memberId: string;
  revisionId: string;
}

export interface RevisionSourceOption extends MemberRevisionSource {
  key: string;
  label: string;
  originalPdf: boolean;
}

/** Only versions reachable from the selected package revision are eligible. */
export function packageRevisionSources(record: ActionPackage, through: string): RevisionSourceOption[] {
  const seen = new Set<string>(), options: RevisionSourceOption[] = [];
  const end = record.revisions.findIndex(revision => revision.id === through);
  for (let i = end; i >= 0; i--) {
    for (const [index, member] of record.revisions[i].members.entries()) {
      const key = JSON.stringify([member.id, member.revisionId]);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ key, memberId: member.id, revisionId: member.revisionId, originalPdf: member.kind === 'original',
        label: `${member.label} · package version ${i + 1}, document ${index + 1}${member.kind === 'original' && member.signedOriginal ? ' · marked signed' : ''}` });
    }
  }
  return options;
}

export function resolvePackageRevisionSource(record: ActionPackage, source: MemberRevisionSource): PackageMember {
  for (const revision of record.revisions) {
    const member = revision.members.find(item => item.id === source.memberId && item.revisionId === source.revisionId);
    if (member) return member;
    if (revision.id === record.currentRevisionId) break;
  }
  throw new Error('This exact document version is unavailable in this package. Select another saved version.');
}
