import {
  reviewPackageNative,
  reviewPackageText,
  reviewPackageOriginal,
} from "./actionPackageDisclosure";
import { APP_VERSION, GIT_SHA } from "./version";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { captureDocumentRevision } from "./capturedDocument";
import { captureFormExportTemplates } from "./formExportTemplates";
import {
  prepareExport,
  acknowledgePreparedExport,
  copyExportReview,
  type ExportReview,
  type ReadyExportJob,
} from "./preparedExport";
import type { PolicyResolution } from "./exportDeploymentPolicy";
import {
  preparePackageMember,
  readPackageAsset,
  readPackageMemberDraft,
  retainPackageAsset,
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
import { withAttachmentStaging } from "./attachments";
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
  member: PackageMember;
  snapshot?: DocumentSnapshot;
  templates?: FormExportTemplates;
  original?: ArrayBuffer;
}
export interface PreparedPackageAssembly {
  readonly revisionId: string;
  readonly readiness: PackageReadiness;
  readonly reviews: Array<{ member: string; review: ExportReview }>;
}
interface AssemblyInput {
  record: ActionPackage;
  revisionId: string;
  inputs: MemberInput[];
  policy: PolicyResolution;
  eligible: boolean;
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
) {
  if (!input.snapshot) throw new Error("Missing native package input.");
  const snapshot = structuredClone(input.snapshot);
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
  });
}
export async function preparePackageAssembly(
  record: ActionPackage,
  revisionId: string,
  policy: PolicyResolution,
): Promise<PreparedPackageAssembly> {
  const owned = structuredClone(record),
    revision = getPackageRevision(owned, revisionId);
  const findings: PackageFinding[] = [],
    reviews: PreparedPackageAssembly["reviews"] = [],
    inputs: MemberInput[] = [];
  const error = (message: string, memberId?: string) =>
    findings.push({ message, memberId, severity: "error" });
  if (policy.status !== "ready") error(policy.message);
  if (!revision.members.length) error("Add a basic letter or main document.");
  if (
    revision.members.filter((member) => member.role === "basic-letter")
      .length !== 1 ||
    revision.members[0]?.role !== "basic-letter"
  )
    error(
      "The package must start with exactly one basic letter or main document.",
    );
  reviews.push({
    member: "Package name and included filenames",
    review: reviewPackageText(
      [
        owned.name,
        ...packageAssets({ ...owned, revisions: [revision] }).map(
          (asset) => asset.name,
        ),
      ].join("\n"),
      "Package metadata",
      policy,
    ),
  });
  let passedEndorsements = false,
    endorsementCount = 0;
  const basic = revision.members[0];
  const basicSession = basic?.kind === "native" ? basic.session : null;
  let previousSession = basicSession;
  for (const member of revision.members) {
    if (member.role !== "basic-letter" && member.role !== "endorsement")
      passedEndorsements = true;
    if (member.role === "endorsement" && passedEndorsements)
      error(
        "Endorsements must follow the basic letter in chain order before supporting members.",
        member.id,
      );
    try {
      if (member.kind === "original") {
        const original = await readPackageAsset(member.original);
        await PDFDocument.load(original);
        reviews.push({
          member: member.label,
          review: await reviewPackageOriginal(original, member.label, policy),
        });
        if (member.role === "endorsement") {
          endorsementCount++;
          previousSession = null;
        }
        inputs.push({ member, original });
        findings.push({
          memberId: member.id,
          severity: "warning",
          message: `${member.label}: review the original PDF content and signing status. The assembled derivative is unsigned.`,
        });
        continue;
      }
      const { reviewed } = await readPackageMemberDraft(member);
      for (const file of [...reviewed.files, reviewed.basicLetter])
        if (file)
          reviews.push({
            member: `${member.label}: ${file.name}`,
            review: await reviewPackageOriginal(file.data, file.name, policy),
          });
      const { snapshot } = await preparePackageMember(member);
      if (member.role === "endorsement" && !isEndorsement(snapshot.docType))
        error(
          "The endorsement role requires an existing native endorsement document or an original PDF.",
          member.id,
        );
      if (member.role === "endorsement") {
        const ordinals = [
          "FIRST",
          "SECOND",
          "THIRD",
          "FOURTH",
          "FIFTH",
          "SIXTH",
          "SEVENTH",
          "EIGHTH",
          "NINTH",
          "TENTH",
        ];
        if (
          !basicSession ||
          basicSession.documentCategory === "forms" ||
          !previousSession
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
            ordinals[endorsementCount]
          )
            error(
              "The endorsement ordinal does not match its position in this package.",
              member.id,
            );
          const expectedReference =
            referenceStartIndex(
              previousSession.docType,
              previousSession.formData.startingReferenceLetter,
            ) + previousSession.references.length;
          const expectedEnclosure =
            enclosureStartNumber(
              previousSession.docType,
              previousSession.formData.startingEnclosureNumber,
            ) + previousSession.enclosures.length;
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
        previousSession = member.session;
      }
      if (isEndorsement(snapshot.docType) && member.role !== "endorsement")
        error("A native endorsement must use the endorsement role.", member.id);
      if (snapshot.documentCategory !== "forms") {
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
          error(`Complete required ${section} fields.`, member.id);
        if (canReviewReferenceOrder(snapshot))
          for (const message of planFirstCitationOrder(snapshot).blockers)
            error(message, member.id);
        const text = snapshot.paragraphs
          .map((paragraph) => paragraph.text)
          .join("\n");
        for (const match of text.matchAll(/\benclosure\s*\((\d+)\)/gi)) {
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
          if (!embedded && !packageLiteral)
            error(
              `Unresolved enclosure (${match[1]}) citation. Linked package enclosure citations are planned for a later release.`,
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
            error(`Complete required ${section} fields.`, member.id);
      }
      let templates: FormExportTemplates | undefined;
      if (snapshot.documentCategory === "forms") {
        const pages: Record<string, Uint8Array> = {};
        for (const [file, asset] of Object.entries(member.templates ?? {}))
          pages[file] = new Uint8Array(await readPackageAsset(asset));
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
        ),
      });
      const input = { member, snapshot, templates },
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
  const result: PreparedPackageAssembly = Object.freeze({
    revisionId,
    readiness: {
      state: !revision.members.length
        ? "draft"
        : findings.some((finding) => finding.severity === "error")
          ? "incomplete"
          : revision.outputs.length
            ? "exported"
            : "ready",
      findings,
    } as PackageReadiness,
    reviews,
  });
  preparedAssemblies.set(result, {
    record: owned,
    revisionId,
    inputs,
    policy,
    eligible: !findings.some((finding) => finding.severity === "error"),
  });
  return result;
}
/** Acknowledgement covers each preserved member's displayed export review and original PDF warnings. */
export async function assemblePackage(
  prepared: PreparedPackageAssembly,
  ports: CorrespondenceRendererPorts & {
    waitForReady(timeoutMs: number): Promise<boolean>;
  },
  signal = new AbortController().signal,
): Promise<ActionPackage> {
  const input = preparedAssemblies.get(prepared);
  if (!input || !input.eligible)
    throw new Error("Resolve package readiness findings before assembly.");
  return withAttachmentStaging(async () => {
    const pdf = await PDFDocument.create(),
      boundaries: PackageBoundary[] = [];
    let continuationPages = 0,
      enclosureNumber = 0;
    for (const memberInput of input.inputs) {
      signal.throwIfAborted();
      const { member } = memberInput;
      let bytes: ArrayBuffer;
      if (memberInput.original) bytes = memberInput.original;
      else {
        const preparation = prepareMember(
          memberInput,
          input.revisionId,
          input.policy,
          continuationPages + 1,
        );
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
              ? await renderPreparedConfiguredForm(ready, signal)
              : ready.job.kind === "builtin-form"
                ? await renderPreparedBuiltinForm(ready, signal)
                : await renderPreparedCorrespondence(ready, ports, signal);
        } catch (cause) {
          if (
            !(cause instanceof Error) ||
            cause.message !== "ENGINE_RESET_NEEDED" ||
            !(await ports.waitForReady(30_000))
          )
            throw cause;
          artifact = await renderPreparedCorrespondence(ready, ports, signal);
        }
        if (artifact.completeness !== "complete")
          throw new Error(
            artifact.issues.map((issue) => issue.message).join(" "),
          );
        bytes = await artifact.blob.arrayBuffer();
      }
      const source = await PDFDocument.load(bytes),
        count = source.getPageCount();
      const separate =
        member.role !== "basic-letter" && member.role !== "endorsement";
      if (member.role === "enclosure") enclosureNumber++;
      const label =
        member.role === "enclosure"
          ? `Enclosure (${enclosureNumber})`
          : separate
            ? member.label
            : String(continuationPages + 1);
      boundaries.push({
        memberId: member.id,
        startPage: pdf.getPageCount() + 1,
        pageCount: count,
        firstPageLabel: label,
        numbering: separate ? "separate" : "continuation",
      });
      const pages = await pdf.copyPages(source, source.getPageIndices());
      const font =
        member.role === "enclosure"
          ? await pdf.embedFont(StandardFonts.Helvetica)
          : undefined;
      pages.forEach((page, index) => {
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
        if (member.kind === "native") {
          const { reviewed } = await readPackageMemberDraft(member);
          for (const [index, file] of reviewed.files.entries())
            if (file)
              nativeEnclosurePages +=
                (await PDFDocument.load(file.data)).getPageCount() +
                (reviewed.session.enclosures[index].hasCoverPage ? 1 : 0);
        }
        continuationPages += count - nativeEnclosurePages;
      }
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(await pdf.save()).buffer;
    const output = {
      id: newPackageId("output"),
      asset: await retainPackageAsset(
        `${input.record.name}.pdf`,
        "application/pdf",
        bytes,
      ),
      createdAt: Date.now(),
      policyIdentity:
        input.policy.status === "ready" ? input.policy.policy.identity : "",
      renderer: `DonDocs ${APP_VERSION} (${GIT_SHA}); package-v1; native-prepared-export-v1; pdf-lib-1.17.1`,
      boundaries,
      signingStatus: "unsigned-assembled-derivative" as const,
    };
    return commitActionPackage(
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
    );
  });
}
