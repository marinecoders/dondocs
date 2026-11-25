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

// Validated package revisions are ordered parent-before-child, but adjacent entries can belong to different branches.
function* savedAncestors(record: ActionPackage, through: string) {
  let next: string | undefined = through;
  for (let index = record.revisions.length - 1; next && index >= 0; index--) {
    const revision = record.revisions[index];
    if (revision.id !== next) continue;
    yield { revision, index };
    next = revision.parentId;
  }
}

/** Only versions reachable from the selected package revision are eligible. */
export function packageRevisionSources(record: ActionPackage, through: string): RevisionSourceOption[] {
  const seen = new Set<string>(), options: RevisionSourceOption[] = [];
  for (const { revision, index: versionIndex } of savedAncestors(record, through)) {
    for (const [index, member] of revision.members.entries()) {
      const key = JSON.stringify([member.id, member.revisionId]);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ key, memberId: member.id, revisionId: member.revisionId, originalPdf: member.kind === 'original',
        label: `${member.label} · package version ${versionIndex + 1}, document ${index + 1}${member.kind === 'original' && member.signedOriginal ? ' · marked signed' : ''}` });
    }
  }
  return options;
}

export function resolvePackageRevisionSource(record: ActionPackage, source: MemberRevisionSource): PackageMember {
  for (const { revision } of savedAncestors(record, record.currentRevisionId)) {
    const member = revision.members.find(item => item.id === source.memberId && item.revisionId === source.revisionId);
    if (member) return member;
  }
  throw new Error('This exact document version is unavailable in this package. Select another saved version.');
}
