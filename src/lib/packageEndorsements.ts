import { ENDORSEMENT_ORDINALS } from './appendedEndorsement';
import type { NativePackageMember, PackageMember, PackageRevision } from './actionPackages';
import { composeBasicLetterId, isEndorsement } from './endorsement';
import { isOutputFieldActive } from './documentFields';
import { isStaffPaper } from './staffPapers';
import { referenceLetterAt } from './referenceLetters';

export function canLeadRecipeEndorsements(member: PackageMember): member is NativePackageMember {
  return member.kind === 'native' && (member.role === 'supporting-document' || member.role === 'basic-letter')
    && member.session.documentCategory !== 'forms' && !isEndorsement(member.session.docType ?? '');
}

export interface PackageEndorsementRoute {
  basicMemberId: string;
  basicRevisionId: string;
  ordinal: string;
  firstReference: string;
  firstEnclosure: number;
}

/** Only contiguous native correspondence can establish the printed reference and enclosure offsets. */
export function packageEndorsementRoutes(revision: Pick<PackageRevision, 'members' | 'templateState'>) {
  const routes = new Map<string, PackageEndorsementRoute>();
  let basic: NativePackageMember | undefined;
  let ordinal = 0, references = 0, enclosures = 0;
  for (const [index, member] of revision.members.entries()) {
    if ((index === 0 && member.role === 'basic-letter' || revision.templateState?.primaryMemberKey) && canLeadRecipeEndorsements(member)) {
      basic = member;
      ordinal = 0;
      // Staff papers can retain hidden letter fields when their document type changes.
      const source = member.session;
      const staff = isStaffPaper(source.docType);
      references = !staff || isOutputFieldActive(source, ['references']) ? source.references?.length ?? 0 : 0;
      enclosures = !staff || isOutputFieldActive(source, ['enclosures']) ? source.enclosures?.length ?? 0 : 0;
    } else if (member.role === 'endorsement' && basic && ordinal < ENDORSEMENT_ORDINALS.length) {
      routes.set(member.id, { basicMemberId: basic.id, basicRevisionId: basic.revisionId,
        ordinal: ENDORSEMENT_ORDINALS[ordinal++], firstReference: referenceLetterAt(references), firstEnclosure: enclosures + 1 });
      if (member.kind === 'native' && isEndorsement(member.session.docType)) {
        references += member.session.references?.length ?? 0;
        enclosures += member.session.enclosures?.length ?? 0;
      } else basic = undefined;
    } else basic = undefined;
  }
  return routes;
}

export function endorsementFields(route: PackageEndorsementRoute, basic: NativePackageMember) {
  return { basicLetterId: composeBasicLetterId(basic.session), endorsementOrdinal: route.ordinal,
    startingReferenceLetter: route.firstReference, startingEnclosureNumber: route.firstEnclosure };
}

export function endorsementLinkIssue(member: PackageMember, route?: PackageEndorsementRoute) {
  const link = member.endorsementLink;
  if (!link) return;
  if (route?.basicMemberId !== link.basicMemberId)
    return 'The linked endorsement is outside its basic letter’s routing chain. Restore the order or link the editable endorsement to its intended letter.';
  if (member.kind !== 'native' && (route.basicRevisionId !== link.basicRevisionId || route.ordinal !== link.ordinal
      || route.firstReference !== link.firstReference || route.firstEnclosure !== link.firstEnclosure))
    return 'The letter revision or routing order changed after this endorsement was captured. Review the original and obtain an updated endorsement.';
}
