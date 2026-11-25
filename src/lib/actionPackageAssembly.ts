import { canLeadRecipeEndorsements, endorsementLinkIssue, packageEndorsementRoutes } from './packageEndorsements';
import { ENDORSEMENT_ORDINALS } from './appendedEndorsement';
import { officialEdition } from '@/services/forms/nativeCatalog';
import { checkPackagePrintablePdf } from './packagePrintableCopy';
import { officialFormCompletionIssues } from './packageFormCompletion';
import { saveGeneratedPdf } from '@/services/pdf/generatedPdfMetadata';
import { directiveIssues } from './directiveFormats';
import { isStaffPaper, staffPaperIssues } from './staffPapers';
import { projectCapturedOutput } from './documentFields';
import { captureVolumePdfDestinations, restoreVolumePdfLinks } from '@/services/pdf/volumePackageLinks';
import { loadAssemblyPdf } from '@/services/pdf/assemblyPdf';
import { reviewPackageSigning } from './packageSigning';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { canMeasurePackageEndorsement, measurePackageEndorsement } from './packageEndorsementPlacement';
import { addPackageFrontMatter } from './packageFrontMatter';
import { addPackageOutputNavigation } from './packageOutputNavigation';
import { MAX_PORTABLE_TOTAL_BYTES, MAX_PORTABLE_RESOURCE_COUNT, portableResourceDigest } from './portableResources';
import { reviewPackageAttachment, renderPackageAttachment } from './packageAttachmentCapabilities';
import { inspectPackageRequirements } from "./packageRequirements";
import { inspectPackageConsistency } from './packageConsistency';
import { packageBindingReadiness } from "./packageFieldBindings";
import {
  reviewPackageNative,
  reviewPackageText,
  reviewPackageInformation,
  reviewPackageBindings,
  reviewPackageRequirements,
  reviewPackageConsistency,
  reviewPackageWork,
  reviewPackageScans,
  reviewPackageOriginal,
} from "./actionPackageDisclosure";
import { APP_VERSION, GIT_SHA } from "./version";
import type { DocumentFieldSource } from "./documentFields";
import { resolvePackageCitations } from "./packageCitations";

import { packageCitationReadiness } from "./packageCitationRepair";
import { PDFDocument } from "pdf-lib";
import { embedPdfFont } from "@/services/pdf/fonts";
import { captureDocumentRevision, copyCapturedDocument } from "./capturedDocument";
import { captureFormExportTemplates } from "./formExportTemplates";
import {
  prepareExport,
  acknowledgePreparedExport,
  copyExportReview,
  type ExportReview,
  type ReadyExportJob,
} from "./preparedExport";
import type { PolicyResolution } from "./exportDeploymentPolicy";
import { preparePackageRenderInput } from './packageRenderInputs';
import {
  readPackageAsset,
  readPackageMemberDraft,
  validatePackageOriginalPdf,
} from "./actionPackageAssets";
import {
  commitActionPackage,
  getPackageRevision,
  newPackageId,
  type ActionPackage,
  type PackageBoundary,
  type PackageMember,
  packageAssets,
} from "./actionPackages";
import { newAttachmentId, withAttachmentStaging } from "./attachments";
import type { StoredAttachment } from "./documentsDb";
import { DOC_TYPE_CONFIG } from "@/types/document";
import { getEditorSections } from "./editorSections";
import {
  missingEditorSections,
  errorBearingIds,
  FORM_ERROR_BEARING_IDS,
  getFormSectionError,
} from "@/components/layout/editorSections";
import {
  planFirstCitationOrder,
  canReviewReferenceOrder,
} from "./referenceCitations";
import {
  isEndorsement,
  composeBasicLetterId,
  referenceStartIndex,
  enclosureStartNumber,
} from "./endorsement";
import type { DocumentSnapshot } from "@/stores/historyStore";
import {
  renderPreparedCorrespondence,
  type CorrespondenceRendererPorts,
} from "@/services/exports/correspondence";
import { renderPreparedConfiguredForm } from "@/services/exports/configuredForms";
import { renderPreparedBuiltinForm } from "@/services/exports/builtinForms";
import type { FormExportTemplates } from "./formExportTemplates";
import { capturePackageRenderProvenance } from "./packageRenderProvenance";
import type { PackageOutput, PackageRevision } from "./actionPackages";

export interface PackageFinding {
  memberId?: string;
  message: string;
  severity: "error" | "warning";
}
export interface PackageReadiness {
  state: "draft" | "incomplete" | "ready" | "exported";
  findings: PackageFinding[];
}
interface MemberInput {
  incompleteFormPreview?: true;
  member: PackageMember;
  snapshot?: DocumentSnapshot;
  templates?: FormExportTemplates;
  original?: ArrayBuffer;
  assets?: CorrespondenceRendererPorts['assets'];
}
export interface PreparedPackageAssembly {
  readonly purpose: "pdf" | "portable";
  readonly revisionId: string;
  readonly readiness: PackageReadiness;
  readonly reviews: Array<{ member: string; review: ExportReview }>;
}
interface AssemblyInput {
  draftPdf: boolean;
  purpose: "pdf" | "portable";
  record: ActionPackage;
  revisionId: string;
  inputs: MemberInput[];
  policy: PolicyResolution;
  eligible: boolean;
  outputs: Map<string, ArrayBuffer>;
  read: typeof readPackageAsset;
}
const preparedAssemblies = new WeakMap<
  PreparedPackageAssembly,
  AssemblyInput
>();

function prepareMember(
  input: MemberInput,
  revisionId: string,
  policy: PolicyResolution,
  startingPageNumber = 1,
  docType?: 'same_page_endorsement' | 'new_page_endorsement',
) {
  if (!input.snapshot) throw new Error("Missing native package input.");
  const snapshot = structuredClone(input.snapshot);
  if (docType) snapshot.docType = docType;
  if (input.member.role === "endorsement") {
    snapshot.formData.startingPageNumber = startingPageNumber;
    // The package contains its basic letter as a separate member. Preserve the captured original, but do not append it twice.
    delete snapshot.formData.basicLetterFile;
    delete snapshot.formData.basicLetterFileRef;
  }
  const captured = captureDocumentRevision(
    {
      documentId: revisionId,
      epoch: 0,
      editSequence: 0,
      capturedAt:
        input.member.kind === "native" ? input.member.session.timestamp : 0,
    },
    snapshot,
  );
  return prepareExport({
    id: `${revisionId}_${input.member.revisionId}`,
    captured,
    target: "pdf",
    filename: "package-member.pdf",
    policy,
    formTemplates: input.templates,
    incompleteFormPreview: input.incompleteFormPreview,
  });
}
export async function preparePackageAssembly(
  record: ActionPackage,
  revisionId: string,
  policy: PolicyResolution,
  options: {
    reviewOriginal?: typeof reviewPackageOriginal;
    readAsset?: typeof readPackageAsset;
    signal?: AbortSignal;
    /** Editable transfers preserve original JSON values omitted from normalized PDF input. */
    includeRetainedDraftText?: boolean;
    draftPdf?: boolean;
  } = {},
): Promise<PreparedPackageAssembly> {
  options.signal?.throwIfAborted();
  const reviewOriginal = options.reviewOriginal ?? reviewPackageOriginal;
  const capturedReads = new Map<string, { identity: string; bytes: ArrayBuffer }>(); let capturedBytes = 0;
  const read: typeof readPackageAsset = options.readAsset ? async asset => {
    const identity = JSON.stringify([asset.name, asset.type, asset.size, asset.sha256]), previous = capturedReads.get(asset.id);
    if (previous) { if (previous.identity !== identity) throw new Error('Conflicting captured package asset identity.'); return previous.bytes.slice(0); }
    const bytes = (await options.readAsset!(asset)).slice(0);
    if (bytes.byteLength !== asset.size || await portableResourceDigest(bytes) !== asset.sha256) throw new Error('The captured package file does not match its saved identity.');
    if (capturedReads.size >= MAX_PORTABLE_RESOURCE_COUNT || bytes.byteLength > MAX_PORTABLE_TOTAL_BYTES - capturedBytes) throw new Error('The captured package exceeds its bounded resource limits.');
    capturedBytes += bytes.byteLength; capturedReads.set(asset.id, { identity, bytes }); return bytes.slice(0);
  } : readPackageAsset;
  const owned = structuredClone(record),
    revision = getPackageRevision(owned, revisionId);
  const linkedEnclosures = new Set(
    (await resolvePackageCitations(revision)).links
      .filter(value => value.state === "current" && value.link.source.kind === "enclosure" && value.link.source.field === "text")
      .map(({ link }) => JSON.stringify([link.source.memberId, link.source.paragraphId, link.source.start, link.source.end])),
  );
  options.signal?.throwIfAborted();
  const purpose = options.includeRetainedDraftText ? "portable" : "pdf";
  const findings: PackageFinding[] = [],
    reviews: PreparedPackageAssembly["reviews"] = [],
    inputs: MemberInput[] = [];
  const outputs = new Map<string, ArrayBuffer>();
  if (purpose === 'pdf' && revision.assembly?.profile === 'forms-led' && !(revision.members[0]?.kind === 'native' && revision.members[0].session.documentCategory === 'forms')
      && !(revision.members[0]?.kind === 'original' && revision.members[0].signedOriginal && revision.members[0].officialFormId))
    findings.push({ severity: 'error', message: 'The forms-led assembly profile needs a captured native form as its first main document.' });
  const error = (message: string, memberId?: string) =>
    findings.push({ message, memberId, severity: "error" });
  if (policy.status !== "ready") error(policy.message);
  if (revision.templateState) {
    const { reviewConditionalPackage, conditionalMembershipFindings } = await import('./packageConditionalSources');
    try { for (const review of await reviewConditionalPackage(revision, policy, read)) reviews.push({ member: 'Captured action intake and template', review }); }
    catch (cause) { error(cause instanceof Error ? cause.message : 'The captured action template could not be reviewed.'); }
    findings.push(...conditionalMembershipFindings(revision).map(finding => ({ ...finding, severity: options.includeRetainedDraftText ? 'warning' as const : 'error' as const })));
  }
  if (revision.information) {
    try { reviews.push({ member: "Package information", review: reviewPackageInformation(revision.information, policy) }); }
    catch (cause) { error(cause instanceof Error ? cause.message : "Package information could not be reviewed."); }
  }
  if (revision.bindings) {
    try { reviews.push({ member: "Package field links", review: reviewPackageBindings(revision.bindings, policy) }); }
    catch (cause) { error(cause instanceof Error ? cause.message : "Package field links could not be reviewed."); }
  }
  if (revision.signing) {
    try { for (const review of await reviewPackageSigning(revision.signing, policy)) reviews.push({ member: 'Package signing history', review }); }
    catch (cause) { error(cause instanceof Error ? cause.message : 'Package signing history could not be reviewed.'); }
  }
  if (revision.scans) {
    try {
      reviews.push({ member: 'Recognized supporting evidence', review: reviewPackageScans(revision.scans, policy) });
      const { reviewPackageScanSources } = await import('./packageScans');
      reviews.push(...await reviewPackageScanSources(revision.scans, policy, { readAsset: read, reviewOriginal, signal: options.signal }));
    }
    catch (cause) { error(cause instanceof Error ? cause.message : 'Recognized evidence could not be reviewed.'); }
  }
  if (revision.work) {
    try { reviews.push({ member: "Package work", review: reviewPackageWork(revision.work, policy) }); }
    catch (cause) { error(cause instanceof Error ? cause.message : "Package work could not be reviewed."); }
  }
  if (revision.requirements) {
    try { reviews.push({ member: "Package requirements", review: reviewPackageRequirements(revision.requirements, policy) }); }
    catch (cause) { error(cause instanceof Error ? cause.message : "Package requirements could not be reviewed."); }
  }
  const workflowFinding = (message: string, memberId?: string) =>
    findings.push({ message, memberId, severity: options.draftPdf ? 'warning' : 'error' });
  if (purpose === 'pdf') {
    for (const member of revision.members.filter(item => item.required)) {
      for (const message of officialFormCompletionIssues(member)) workflowFinding(message, member.id);
    }
    for (const handoff of revision.signing?.handoffs ?? []) {
      const target = handoff.target;
      if (target.kind !== 'member' || !revision.members.some(member => member.required && member.id === target.id && member.revisionId === target.revisionId)) continue;
      if (!handoff.returns?.some(returned => returned.assessment === 'checks-agree' && revision.members.some(member =>
        member.id === returned.memberId && member.kind === 'original' && member.original.sha256 === returned.returnedAsset.sha256)))
        workflowFinding('The signing handoff still needs a matching returned PDF.', target.id);
    }
  }
  const requirements = await inspectPackageRequirements(revision, options.includeRetainedDraftText ? "portable" : "pdf", { signal: options.signal, readAsset: read });
  if (revision.consistency) {
    try { reviews.push({ member: 'Package relationships', review: reviewPackageConsistency(revision.consistency, policy) }); }
    catch (cause) { error(cause instanceof Error ? cause.message : 'The package relationships could not be reviewed.'); }
  }
  for (const finding of (await inspectPackageConsistency(revision, options.signal)).findings) if (['conflict', 'unresolved'].includes(finding.state))
    findings.push({ message: `${finding.label}: ${finding.message}`, memberId: finding.destinations.find(target => target.memberId)?.memberId,
      severity: purpose === 'portable' || !finding.required ? 'warning' : 'error' });
  for (const item of requirements.items) if (["missing", "unknown", "invalid"].includes(item.state)) (item.state === 'invalid' ? error : workflowFinding)(`${item.label}: ${item.message}`, item.memberId);
  findings.push(...(await packageBindingReadiness(revision)).map(finding => ({ ...finding, severity: options.includeRetainedDraftText ? "warning" as const : "error" as const })));
  const completeness = (message: string, memberId?: string) => findings.push({ message, memberId, severity: purpose === "portable" ? "warning" as const : "error" as const });
  if (!revision.members.length) completeness("Add a basic letter or main document before PDF assembly.");
  findings.push(...(await packageCitationReadiness(revision)).map(item => ({ ...item, severity: purpose === "portable" ? "warning" as const : item.severity })));
  const primaryKey = revision.templateState?.primaryMemberKey;
  const primary = primaryKey && revision.templateState?.instances.find(slot => slot.memberKey === primaryKey);
  const first = revision.members[0];
  const validPrimary = primaryKey ? primary && first && first.id === primary.memberId : first?.role === 'basic-letter';
  if (!validPrimary || revision.members.slice(1).some(member => member.role === 'basic-letter')) {
    completeness("The package must start with exactly one basic letter or main document.");
  }
  try {
    reviews.push({
      member: "Package name and included filenames",
      review: reviewPackageText(
        [
          owned.name,
          ...packageAssets({ ...owned, revisions: [revision], reviewRounds: undefined }).map(
            (asset) => asset.name,
          ),
        ].join("\n"),
        "Package metadata",
        policy,
      ),
    });
  } catch (cause) {
    error(
      cause instanceof Error
        ? cause.message
        : "Package metadata could not be reviewed.",
    );
  }
  for (const output of revision.outputs) {
    options.signal?.throwIfAborted();
    try {
      const bytes = await read(output.asset);
      const pdf = await PDFDocument.load(bytes);
      if (
        pdf.getPageCount() !==
        Math.max(output.assembly?.frontMatterPages ?? 0, ...output.boundaries.map(boundary => boundary.startPage + boundary.pageCount - 1))
      )
        throw new Error(
          "The retained PDF does not match its preserved member boundaries.",
        );
      reviews.push({
        member: `Retained PDF: ${output.asset.name}`,
        review: await reviewOriginal(bytes, output.asset.name, policy),
      });
      outputs.set(output.asset.id, bytes);
    } catch (cause) {
      error(
        cause instanceof Error
          ? cause.message
          : "A retained output could not be reviewed.",
      );
    }
  }
  const routes = packageEndorsementRoutes(revision);
  let passedEndorsements = false,
    endorsementCount = 0;
  const basic = revision.members[0];
  let basicSession = basic?.kind === "native" ? basic.session : null;
  let previousSnapshot: DocumentSnapshot | null = null;
  for (const member of revision.members) {
    options.signal?.throwIfAborted();
    const linkIssue = endorsementLinkIssue(member, routes.get(member.id));
    if (purpose === "pdf" && linkIssue) error(linkIssue, member.id);
    const startsLetterChain = !!primaryKey && canLeadRecipeEndorsements(member);
    if (startsLetterChain && member.kind === 'native') {
      basicSession = member.session;
      endorsementCount = 0;
      passedEndorsements = false;
    } else if (member.role !== "basic-letter" && member.role !== "endorsement")
      passedEndorsements = true;
    if (member.role === "endorsement" && passedEndorsements)
      completeness(
        "Endorsements must follow the basic letter in chain order before supporting members.",
        member.id,
      );
    try {
      if (member.kind === "attachment") {
        const bytes = await read(member.original);
        const { inspection, review } = await reviewPackageAttachment(member.original, bytes, policy, options.signal);
        reviews.push({ member: member.label, review });
        if (purpose === "pdf") {
          if (!inspection.canRenderPdf) error(`${member.label}: this supporting format has no qualified PDF conversion. Add a reviewed PDF or use editable handoff.`, member.id);
          else inputs.push({ member, original: await renderPackageAttachment(member.original, bytes, options.signal) });
        }
        continue;
      }
      if (member.kind === "original") {
        const original = await read(member.original);
        await validatePackageOriginalPdf(original);
        const copy = member.printableCopy?.asset;
        const printable = copy ? await read(copy) : original;
        reviews.push({ member: member.label, review: await reviewOriginal(original, member.label, policy) });
        if (copy) reviews.push({ member: member.label + ' · Printable copy', review: await reviewOriginal(printable, copy.name, policy) });
        if (purpose === 'pdf') {
          try {
            if (!copy && member.officialFormId && officialEdition(member.officialFormId)?.format === 'xfa')
              throw new Error('Use editable package or recipient delivery to retain this signed XFA form.');
            await checkPackagePrintablePdf(printable, options.signal);
          } catch (cause) {
            options.signal?.throwIfAborted();
            error(`${member.label}: ${cause instanceof Error ? cause.message : 'This PDF cannot be assembled.'} Add a reviewed printable copy in Documents.`, member.id);
          }
        }
        if (member.role === "endorsement") {
          endorsementCount++;
          previousSnapshot = null;
        }
        inputs.push({ member, original: printable });
        findings.push({
          memberId: member.id,
          severity: "warning",
          message: `${member.label}: ${copy ? 'assembled pages use the printable copy (' + copy.name + '). ' : ''}Review the original PDF content and signing status. The assembled derivative is unsigned. Imported links and interactive fields are omitted, and printable annotations may be included as page images.`,
        });
        continue;
      }
      const { draft, reviewed } = await readPackageMemberDraft(member, read);
      for (const file of [
        ...reviewed.files,
        reviewed.basicLetter,
        ...reviewed.figures.filter((_, index) => reviewed.session.paragraphs[index]?.figure?.type === "application/pdf"),
      ])
        if (file)
          reviews.push({
            member: `${member.label}: ${file.name}`,
            review: await reviewOriginal(file.data, file.name, policy),
          });
      if (purpose === "portable") {
        reviews.push({ member: `${member.label}: complete retained draft`, review: reviewPackageNative(member.session, `${owned.name}: ${member.label}`, policy, draft as DocumentFieldSource) });
        continue;
      }
      const { snapshot: retainedSnapshot, assets } = await preparePackageRenderInput(member, read);
      // Readiness and PDF page counts must use the same sections that render.
      const snapshot = retainedSnapshot.documentCategory !== 'forms' && isStaffPaper(retainedSnapshot.docType)
        ? copyCapturedDocument(projectCapturedOutput(captureDocumentRevision({
          documentId: member.revisionId, epoch: 0, editSequence: 0, capturedAt: member.session.timestamp,
        }, retainedSnapshot))).document
        : retainedSnapshot;
      if (member.role === "basic-letter" || startsLetterChain) previousSnapshot = snapshot;
      if (snapshot.documentCategory !== "forms" && snapshot.docType === "business_letter" && snapshot.paragraphs.some(paragraph => paragraph.figure?.type === "application/pdf"))
        error("Business-letter figures require PNG or JPEG images. Convert the PDF figure and save a new package revision.", member.id);
      if (member.role === "endorsement" && !isEndorsement(snapshot.docType))
        error(
          "The endorsement role requires an existing native endorsement document or an original PDF.",
          member.id,
        );
      if (member.role === "endorsement") {
        if (
          !basicSession ||
          basicSession.documentCategory === "forms" ||
          !previousSnapshot
        )
          error(
            "This native endorsement chain cannot be verified. Use a native basic letter and a contiguous native endorsement chain.",
            member.id,
          );
        else {
          if (
            snapshot.formData.basicLetterId?.trim() !==
            composeBasicLetterId(basicSession)
          )
            error(
              "The endorsement basic-letter identity does not match the captured main document.",
              member.id,
            );
          if (
            snapshot.formData.endorsementOrdinal?.toUpperCase() !==
            ENDORSEMENT_ORDINALS[endorsementCount]
          )
            error(
              "The endorsement ordinal does not match its position in this package.",
              member.id,
            );
          const expectedReference =
            referenceStartIndex(
              previousSnapshot.docType,
              previousSnapshot.formData.startingReferenceLetter,
            ) + previousSnapshot.references.length;
          const expectedEnclosure =
            enclosureStartNumber(
              previousSnapshot.docType,
              previousSnapshot.formData.startingEnclosureNumber,
            ) + previousSnapshot.enclosures.length;
          if (
            snapshot.references.length &&
            referenceStartIndex(
              snapshot.docType,
              snapshot.formData.startingReferenceLetter,
            ) !== expectedReference
          )
            error(
              "The endorsement reference sequence contradicts the preceding member.",
              member.id,
            );
          if (
            snapshot.enclosures.length &&
            enclosureStartNumber(
              snapshot.docType,
              snapshot.formData.startingEnclosureNumber,
            ) !== expectedEnclosure
          )
            error(
              "The endorsement enclosure sequence contradicts the preceding member.",
              member.id,
            );
        }
        endorsementCount++;
        previousSnapshot = snapshot;
      }
      if (isEndorsement(snapshot.docType) && member.role !== "endorsement")
        error("A native endorsement must use the endorsement role.", member.id);
      if (snapshot.documentCategory !== "forms") {
        for (const message of directiveIssues(snapshot.docType, snapshot.formData)) error(message, member.id);
        for (const message of staffPaperIssues(snapshot.docType, snapshot.formData)) error(message, member.id);
        const config = DOC_TYPE_CONFIG[snapshot.docType];
        if (!config)
          throw new Error("This native document type is unsupported.");
        const sections = getEditorSections(config, snapshot.docType)
          .map((section) => section.id)
          .filter((id) => errorBearingIds(config).includes(id));
        for (const section of missingEditorSections(
          sections,
          snapshot.formData,
          snapshot.paragraphs,
          config,
          snapshot.endItems,
        ))
          workflowFinding(`Complete required ${section} fields.`, member.id);
        if (canReviewReferenceOrder(snapshot))
          for (const message of planFirstCitationOrder(snapshot).blockers)
            error(message, member.id);
        let paragraphOffset = 0;
        const paragraphSpans = snapshot.paragraphs.map(paragraph => {
          const start = paragraphOffset;
          paragraphOffset += paragraph.text.length + 1;
          return { id: paragraph.id, start, end: start + paragraph.text.length };
        });
        const text = snapshot.paragraphs.map(paragraph => paragraph.text).join("\n");
        for (const match of text.matchAll(/\benclosure\s*\((\d+)\)/gi)) {
          const paragraph = paragraphSpans.find(span => match.index >= span.start && match.index + match[0].length <= span.end);
          const labelStart = paragraph ? match.index - paragraph.start + match[0].lastIndexOf(match[1]) : -1;
          const linked = paragraph?.id !== undefined && linkedEnclosures.has(
            JSON.stringify([member.id, paragraph.id, labelStart, labelStart + match[1].length]),
          );
          const offset = snapshot.formData.startingEnclosureNumber ?? 1;
          const embedded =
            Number(match[1]) >= offset &&
            Number(match[1]) < offset + snapshot.enclosures.length;
          const packageEnclosures = revision.members.filter(
            (member) => member.role === "enclosure",
          );
          const packageLiteral =
            !snapshot.enclosures.length &&
            Number(match[1]) >= 1 &&
            Number(match[1]) <= packageEnclosures.length;
          if (!linked && !embedded && !packageLiteral)
            error(
              `Unresolved enclosure (${match[1]}) citation. Link its current package target or correct the literal citation before assembling.`,
              member.id,
            );
        }
      } else if (!snapshot.genericForm) {
        const form =
          snapshot.formType === "navmc_118_11"
            ? snapshot.forms?.navmc11811
            : snapshot.forms?.navmc10274;
        if (!form) throw new Error("The saved built-in form is missing.");
        for (const section of FORM_ERROR_BEARING_IDS[snapshot.formType!] ?? [])
          if (getFormSectionError(snapshot.formType!, section, form))
            workflowFinding(`Complete required ${section} fields.`, member.id);
      }
      let templates: FormExportTemplates | undefined;
      if (snapshot.documentCategory === "forms") {
        const pages: Record<string, Uint8Array> = {};
        for (const [file, asset] of Object.entries(member.templates ?? {}))
          pages[file] = new Uint8Array(await read(asset));
        if (!Object.keys(pages).length)
          throw new Error("The exact saved form templates are missing.");
        templates = captureFormExportTemplates(
          snapshot.genericForm ? "configured-form" : "builtin-form",
          snapshot.formType!,
          pages,
          snapshot.genericForm
            ? JSON.stringify(snapshot.genericForm.definition)
            : undefined,
        );
      }
      reviews.push({
        member: `${member.label}: complete retained draft`,
        review: reviewPackageNative(
          member.session,
          `${owned.name}: ${member.label}`,
          policy,
          options.includeRetainedDraftText ? draft as DocumentFieldSource : undefined,
        ),
      });
      const input: MemberInput = { member, snapshot, templates, assets,
        incompleteFormPreview: options.draftPdf && snapshot.genericForm ? true : undefined },
        preparation = prepareMember(input, revisionId, policy);
      inputs.push(input);
      if ("issues" in preparation)
        preparation.issues.forEach((message) => error(message, member.id));
      else
        reviews.push({
          member: member.label,
          review: copyExportReview(
            preparation.status === "ready"
              ? preparation.job.job
              : preparation.job,
          ),
        });
    } catch (cause) {
      error(
        cause instanceof Error
          ? cause.message
          : "The saved member could not be read.",
        member.id,
      );
    }
  }
  options.signal?.throwIfAborted();
  const result: PreparedPackageAssembly = Object.freeze({
    purpose,
    revisionId,
    readiness: {
      state: purpose === "pdf" && !revision.members.length
        ? "draft"
        : findings.some((finding) => finding.severity === "error")
          ? "incomplete"
          : purpose === "portable" ? "ready" : revision.outputs.length
            ? "exported"
            : "ready",
      findings,
    } as PackageReadiness,
    reviews,
  });
  preparedAssemblies.set(result, {
    purpose,
    draftPdf: options.draftPdf === true,
    record: owned,
    revisionId,
    inputs,
    policy,
    outputs,
    read,
    eligible: !findings.some((finding) => finding.severity === "error"),
  });
  return result;
}
/** Retrieve the exact retained bytes inspected for this current operation. */
export function copyPreparedPackageOutput(
  prepared: PreparedPackageAssembly,
  assetId: string,
): ArrayBuffer {
  const input = preparedAssemblies.get(prepared),
    bytes = input?.outputs.get(assetId);
  if (!input?.eligible || !bytes)
    throw new Error("Review this retained output again before retrieving it.");
  return bytes.slice(0);
}

/** Bind comparison to the same private capture whose contents were reviewed. */
export function capturePreparedPackageComparison(
  prepared: PreparedPackageAssembly,
  beforeId: string,
  afterId: string,
): { revision: PackageRevision; before: PackageOutput; after: PackageOutput; beforeBytes: ArrayBuffer; afterBytes: ArrayBuffer } {
  const input = preparedAssemblies.get(prepared);
  if (!input?.eligible || beforeId === afterId)
    throw new Error("Choose two different retained PDFs from this reviewed revision.");
  const revision = getPackageRevision(input.record, input.revisionId);
  const before = revision.outputs.find(output => output.id === beforeId);
  const after = revision.outputs.find(output => output.id === afterId);
  if (!before || !after)
    throw new Error("Both retained PDFs must belong to the same reviewed package revision.");
  return {
    revision: structuredClone(revision),
    before: structuredClone(before),
    after: structuredClone(after),
    beforeBytes: copyPreparedPackageOutput(prepared, before.asset.id),
    afterBytes: copyPreparedPackageOutput(prepared, after.asset.id),
  };
}

export function assertPreparedPackagePolicy(prepared: PreparedPackageAssembly, policy: PolicyResolution): void {
  const input = preparedAssemblies.get(prepared);
  if (!input?.eligible || input.policy.status !== "ready" || policy.status !== "ready"
    || input.policy.policy.identity !== policy.policy.identity)
    throw new Error("The export policy changed. Review this package operation again.");
}
function assemblyPolicyCurrent(input: AssemblyInput): boolean {
  const current = getExportDeploymentPolicySync();
  return input.policy.status === 'ready' && current.status === 'ready' && current.policy.identity === input.policy.policy.identity;
}
async function assertAssemblyPolicyCurrent(input: AssemblyInput): Promise<void> {
  const current = await getExportDeploymentPolicy();
  if (input.policy.status !== 'ready' || current.status !== 'ready' || current.policy.identity !== input.policy.policy.identity || !assemblyPolicyCurrent(input))
    throw new Error('The export policy changed. Review this package assembly again.');
}
async function renderMemberBytes(memberInput: MemberInput, revisionId: string, policy: PolicyResolution,
  startingPageNumber: number, ports: Parameters<typeof assemblePackage>[1], signal: AbortSignal,
  docType?: 'same_page_endorsement' | 'new_page_endorsement'): Promise<ArrayBuffer> {
  const preparation = prepareMember(memberInput, revisionId, policy, startingPageNumber, docType);
  const renderPorts = memberInput.assets ? { ...ports, assets: memberInput.assets } : ports;
        if ("issues" in preparation)
          throw new Error(preparation.issues.join(" "));
        const ready: ReadyExportJob =
          preparation.status === "ready"
            ? preparation.job
            : acknowledgePreparedExport(preparation.job);
        if (
          ready.job.kind === "correspondence" &&
          !(await ports.waitForReady(30_000))
        )
          throw new Error(
            "The PDF engine is still starting. Retry assembly when it is ready.",
          );
        let artifact;
        try {
          artifact =
            ready.job.kind === "configured-form"
              ? await renderPreparedConfiguredForm(ready, signal, 'printable')
              : ready.job.kind === "builtin-form"
                ? await renderPreparedBuiltinForm(ready, signal, 'printable')
                : await renderPreparedCorrespondence(ready, renderPorts, signal);
        } catch (cause) {
          if (
            !(cause instanceof Error) ||
            cause.message !== "ENGINE_RESET_NEEDED" ||
            !(await ports.waitForReady(30_000))
          )
            throw cause;
          artifact = await renderPreparedCorrespondence(ready, renderPorts, signal);
        }
        if (artifact.completeness !== "complete")
          throw new Error(
            artifact.issues.map((issue) => issue.message).join(" "),
          );
  return artifact.blob.arrayBuffer();
}
export interface PackageGeneratedPdfKey {
  memberId: string;
  startingPageNumber: number;
  docType: 'default' | 'same_page_endorsement' | 'new_page_endorsement';
}
export interface PackageAssemblyControls {
  maximumPages?: number;
  loadGeneratedPdf?(key: PackageGeneratedPdfKey): Promise<ArrayBuffer | null>;
  saveGeneratedPdf?(key: PackageGeneratedPdfKey, bytes: ArrayBuffer): Promise<void>;
  memberCompleted?(progress: { memberId: string; completed: number; total: number }): Promise<void>;
  commit?(before: ActionPackage, after: ActionPackage, signal: AbortSignal, staged: readonly StoredAttachment[]): Promise<ActionPackage>;
}
/** Acknowledgement covers each preserved member's displayed export review and original PDF warnings. */
export async function assemblePackage(
  prepared: PreparedPackageAssembly,
  ports: CorrespondenceRendererPorts & {
    waitForReady(timeoutMs: number): Promise<boolean>;
  },
  signal = new AbortController().signal,
  controls: PackageAssemblyControls = {},
): Promise<ActionPackage> {
  if (preparedAssemblies.get(prepared)?.draftPdf) throw new Error('Prepare a final PDF before retaining a package output.');
  return renderPackageAssembly(prepared, ports, signal, controls);
}

export async function renderPackageDraft(prepared: PreparedPackageAssembly, ports: Parameters<typeof assemblePackage>[1], signal: AbortSignal) {
  if (!preparedAssemblies.get(prepared)?.draftPdf) throw new Error('Prepare the draft PDF first.');
  let bytes: ArrayBuffer | undefined;
  await renderPackageAssembly(prepared, ports, signal, { commit: async (before, _after, _signal, assets) => {
    bytes = assets[0].data; return before;
  } });
  if (!bytes) throw new Error('The draft PDF could not be rendered.');
  return new Uint8Array(bytes);
}

async function renderPackageAssembly(prepared: PreparedPackageAssembly, ports: Parameters<typeof assemblePackage>[1],
  signal: AbortSignal, controls: PackageAssemblyControls): Promise<ActionPackage> {
  const input = preparedAssemblies.get(prepared);
  if (!input || !input.eligible) throw new Error("Resolve package readiness findings before assembly.");
  if (input.purpose !== "pdf") throw new Error("Review PDF assembly requirements before assembling this package.");
  await assertAssemblyPolicyCurrent(input); signal.throwIfAborted();
  return withAttachmentStaging(async () => {
    let pdf = await PDFDocument.create();
    let boundaries: PackageBoundary[] = [];
    const volumeDestinations = new Map<string, ReturnType<typeof captureVolumePdfDestinations>>();
    let continuationPages = 0,
      enclosureNumber = 0;
    let previous: { member: PackageMember; bytes: ArrayBuffer } | undefined;
    const placements: Array<{ memberId: string; placement: 'same-page' | 'new-page'; reason: string }> = [];
    let completed = 0;
    const generated = async (memberInput: MemberInput, startingPageNumber: number, docType?: 'same_page_endorsement' | 'new_page_endorsement') => {
      signal.throwIfAborted();
      const key: PackageGeneratedPdfKey = { memberId: memberInput.member.id, startingPageNumber, docType: docType ?? 'default' };
      const cached = await controls.loadGeneratedPdf?.(key);
      if (cached) return cached;
      const bytes = await renderMemberBytes(memberInput, input.revisionId, input.policy, startingPageNumber, ports, signal, docType);
      signal.throwIfAborted();
      await controls.saveGeneratedPdf?.(key, bytes);
      return bytes;
    };
    const formsLed = !!getPackageRevision(input.record, input.revisionId).templateState?.primaryMemberKey;
    for (const [index, memberInput] of input.inputs.entries()) {
      signal.throwIfAborted();
      const { member } = memberInput;
      const leadsEndorsements = formsLed && canLeadRecipeEndorsements(member) && input.inputs[index + 1]?.member.role === 'endorsement';
      if (formsLed && member.role !== 'endorsement') continuationPages = 0;
      let bytes: ArrayBuffer;
      if (memberInput.original) bytes = memberInput.original;
      else {
        bytes = await generated(memberInput, continuationPages + 1,
          getPackageRevision(input.record, input.revisionId).assembly?.samePageEndorsements && member.role === 'endorsement' ? 'same_page_endorsement' : undefined);
      }
      let shared = false;
      if (getPackageRevision(input.record, input.revisionId).assembly?.samePageEndorsements && member.role === 'endorsement') {
        const measurement = previous && canMeasurePackageEndorsement(previous.member, member)
          ? await measurePackageEndorsement(previous.bytes, bytes, previous.member, member, signal)
          : { fits: false, reason: 'The preceding member and endorsement are not qualified unsigned native correspondence.' };
        if (measurement.fits && measurement.sourceTop !== undefined && measurement.sourceBottom !== undefined && measurement.targetBottom !== undefined && measurement.sourceTop > measurement.sourceBottom) {
          const measuredPdf = await PDFDocument.load(bytes);
          const embedded = await pdf.embedPage(measuredPdf.getPage(0), { left: 0, right: 612, top: measurement.sourceTop, bottom: measurement.sourceBottom });
          pdf.getPage(pdf.getPageCount() - 1).drawPage(embedded, { x: 0, y: measurement.targetBottom, width: 612, height: measurement.sourceTop - measurement.sourceBottom });
          shared = true;
        } else if (memberInput.snapshot) {
          bytes = await generated(memberInput, continuationPages + 1, 'new_page_endorsement');
        }
        placements.push({ memberId: member.id, placement: shared ? 'same-page' : 'new-page', reason: measurement.reason });
      }
      const source = member.kind === 'original' ? (await loadAssemblyPdf(bytes, signal)).pdf : await PDFDocument.load(bytes);
      const count = source.getPageCount();
      if (member.kind === 'native' && member.session.docType === 'technical_volume')
        volumeDestinations.set(member.id, captureVolumePdfDestinations(source));
      if (controls.maximumPages && pdf.getPageCount() + (shared ? 0 : count) > controls.maximumPages)
        throw new Error(`This assembly exceeds its ${controls.maximumPages}-page memory limit. Use a smaller delivery.`);
      const separate =
        member.role !== "basic-letter" && member.role !== "endorsement" && !leadsEndorsements;
      if (member.role === "enclosure") enclosureNumber++;
      const label =
        member.role === "enclosure"
          ? `Enclosure (${enclosureNumber})`
          : separate
            ? member.label
            : String(continuationPages + 1);
      boundaries.push({
        memberId: member.id,
        startPage: pdf.getPageCount() + (shared ? 0 : 1),
        pageCount: count,
        firstPageLabel: shared ? String(continuationPages) : label,
        numbering: separate ? "separate" : "continuation",
      });
      const pages = await pdf.copyPages(source, source.getPageIndices());
      const font =
        member.role === "enclosure"
          ? await embedPdfFont(pdf, "helvetica")
          : undefined;
      if (!shared) pages.forEach((page, index) => {
        pdf.addPage(page);
        if (font)
          page.drawText(`Enclosure (${enclosureNumber}) — ${index + 1}`, {
            x: 36,
            y: 18,
            size: 9,
            font,
          });
      });
      if (!separate) {
        let nativeEnclosurePages = 0;
        for (const enclosure of memberInput.snapshot?.enclosures ?? [])
          if (enclosure.file)
            nativeEnclosurePages +=
              (await PDFDocument.load(enclosure.file.data)).getPageCount() + Number(!!enclosure.hasCoverPage);
        continuationPages += count - nativeEnclosurePages - Number(shared);
      }
      previous = shared ? undefined : { member, bytes };
      signal.throwIfAborted();
      await controls.memberCompleted?.({ memberId: member.id, completed: ++completed, total: input.inputs.length });
    }
    signal.throwIfAborted();
    const planned = await addPackageFrontMatter(pdf, getPackageRevision(input.record, input.revisionId), input.record.name, boundaries);
    pdf = planned.pdf; boundaries = planned.boundaries;
    for (const boundary of boundaries) {
      const destinations = volumeDestinations.get(boundary.memberId);
      if (destinations) restoreVolumePdfLinks(pdf, destinations, boundary.startPage - 1, boundary.pageCount);
    }
    if (controls.maximumPages && pdf.getPageCount() > controls.maximumPages)
      throw new Error(`This assembly including its front matter exceeds its ${controls.maximumPages}-page memory limit.`);
    const navigation = addPackageOutputNavigation(pdf, getPackageRevision(input.record, input.revisionId), boundaries);
    if (input.draftPdf) {
      const font = await embedPdfFont(pdf, 'helvetica');
      for (const page of pdf.getPages()) page.drawText('DRAFT', { x: 12, y: 8, size: 10, font });
    }
    const bytes = new Uint8Array(await saveGeneratedPdf(pdf)).buffer;
    await assertAssemblyPolicyCurrent(input); signal.throwIfAborted();
    const staged: StoredAttachment = { id: newAttachmentId(), name: `${input.record.name}.pdf`, type: 'application/pdf', size: bytes.byteLength, data: bytes };
    const output = {
      id: newPackageId("output"),
      asset: { id: staged.id, name: staged.name, type: staged.type, size: staged.size, sha256: await portableResourceDigest(bytes) },
      createdAt: Date.now(),
      policyIdentity:
        input.policy.status === "ready" ? input.policy.policy.identity : "",
      renderer: `DonDocs ${APP_VERSION} (${GIT_SHA}); templates ${__LATEX_TEMPLATES_REVISION__}; package-v1; prepared-export-v1; pdf-lib-1.17.1`,
      provenance: await capturePackageRenderProvenance(getPackageRevision(input.record, input.revisionId)),
      boundaries,
      navigation,
      ...(getPackageRevision(input.record, input.revisionId).assembly ? { assembly: { version: 1 as const, profile: getPackageRevision(input.record, input.revisionId).assembly!.profile, frontMatterPages: planned.frontMatterPages, placements } } : {}),
      signingStatus: "unsigned-assembled-derivative" as const,
    };
    return (controls.commit ?? ((before, after, operationSignal, assets) => commitActionPackage(before, after, operationSignal, () => assemblyPolicyCurrent(input), assets)))(
      input.record,
      {
        ...input.record,
        sequence: input.record.sequence + 1,
        revisions: input.record.revisions.map((revision) =>
          revision.id === input.revisionId
            ? { ...revision, outputs: [...revision.outputs, output] }
            : revision,
        ),
      },
      signal,
      [staged],
    );
  });
}
