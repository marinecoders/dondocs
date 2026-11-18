import { packageSigningText, type PackageSigning } from './packageSigningModel';
import { packageScansText, type PackageScans } from './packageScanModel';
import { packageWorkText, type PackageWork } from "./packageWorkModel";
import { packageRequirementsText, type PackageRequirements } from "./packageRequirementsModel";
import { packageConsistencyText, type PackageConsistency } from './packageConsistencyModel';
import { documentTextFields, type DocumentFieldSource } from "./documentFields";
import type { SerializedSession } from "@/stores/documentStore";
import { captureChangeReport, prepareChangeReport } from "./changeReport";
import { detectTextPII, mergePIIResults } from "@/services/pii/detector";
import { CLASSIFICATION_LABELS, retainedTextClassificationLevel } from "./detectClassification";
import { classificationRank } from "./overallClassification";
import { assertRetainedDocumentTextPolicy } from "./retainedDocumentTextPolicy";
import {
  assertExportDeploymentPolicy,
  type PolicyResolution,
} from "./exportDeploymentPolicy";
import type { ExportReview } from "./preparedExport";
import { packageInformationText, type PackageInformation } from "./packageInformation";

import { packageBindingsText, type PackageFieldBindings } from "./packageFieldBindings";

export function reviewPackageSigningMetadata(signing: PackageSigning, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageSigningText(signing), 'Package signing associations and assignments', policy);
}

export function reviewPackageScans(scans: PackageScans, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageScansText(scans), 'Recognized and corrected evidence, including retained original text', policy);
}

export function reviewPackageConsistency(consistency: PackageConsistency, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageConsistencyText(consistency), 'Package relationships and retained exception reasons', policy);
}

export function reviewPackageWork(work: PackageWork, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageWorkText(work), "Package work, responsible people and deadlines", policy);
}

export function reviewPackageRequirements(requirements: PackageRequirements, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageRequirementsText(requirements), "Package evidence requirements and declared confirmations", policy);
}

export function reviewPackageBindings(bindings: PackageFieldBindings, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageBindingsText(bindings), "Package field links and retained values", policy);
}

export function reviewPackageInformation(information: PackageInformation, policy: PolicyResolution): ExportReview {
  return reviewPackageText(packageInformationText(information), "Package information and captured sources", policy);
}

/** Portable/native package review includes retained inactive values and discussion text. */
export function reviewPackageNative(
  session: SerializedSession,
  title: string,
  policy: PolicyResolution,
  retained: DocumentFieldSource = session,
): ExportReview {
  const empty = {
    ...session,
    genericForm: undefined,
    forms: undefined,
    formData: {},
    paragraphs: [],
    references: [],
    enclosures: [],
    copyTos: [],
    distributions: [],
    endItems: [],
    publicationTables: {},
    reviewComments: undefined,
  };
  const report = prepareChangeReport(
    captureChangeReport(
      { label: "Empty", title: "", session: empty },
      { label: "Captured package member", title, session },
      new Date(session.timestamp || 0).toISOString(),
    ),
    policy,
  );
  const fields = documentTextFields(retained, "share", { includeUnknownDataUris: true }).map((field) => ({
    field: field.label,
    value: field.text,
  }));
  // The portable native model includes definitions, unused choices and retained legacy values too.
  assertRetainedDocumentTextPolicy(retained, policy);
  const retainedNotices: string[] = [];
  if (retained !== session) {
    let highest: keyof typeof CLASSIFICATION_LABELS = "unclassified";
    for (const field of fields) {
      const level = retainedTextClassificationLevel(field.value);
      if (classificationRank(level)! > classificationRank(highest)!) highest = level;
    }
    if (highest !== "unclassified") retainedNotices.push(
      `Retained transfer text marking: ${CLASSIFICATION_LABELS[highest]}. Review the original retained content before transfer.`,
    );
  }
  return {
    privacy: mergePIIResults([report.privacy, detectTextPII(fields)]),
    notices: [...report.notices, `${retained === session ? "Retained draft" : "Native document"} marking: ${report.marking}`, ...retainedNotices],
    structure: [],
    markingReview: report.notices.length > 0 || retainedNotices.length > 0,
  };
}
export function reviewPackageText(
  text: string,
  label: string,
  policy: PolicyResolution,
): ExportReview {
  if (policy.status !== "ready") throw new Error(policy.message);
  assertExportDeploymentPolicy(policy.policy);
  const marking = retainedTextClassificationLevel(text);
  if (!policy.policy.allowedLevels.includes(marking))
    throw new Error(
      `${label} includes markings outside this deployment's configured levels.`,
    );
  return {
    privacy: detectTextPII([{ field: label, value: text }]),
    notices: [],
    structure: [],
    markingReview: false,
  };
}

/** Inspect already captured PDF bytes without re-reading a source or local handle. */
export async function reviewPackageOriginal(
  bytes: ArrayBuffer,
  label: string,
  policy: PolicyResolution,
): Promise<ExportReview> {
  let text = "",
    inspected = true;
  try {
    const { extractPdfText } = await import("./pdfText");
    text = await extractPdfText(bytes.slice(0));
  } catch {
    inspected = false;
  }
  const review = reviewPackageText(`${label}\n${text}`, label, policy);
  review.notices.push(
    !inspected
      ? "PDF text could not be inspected automatically. Review every original page manually for markings and personal information."
      : !text.trim()
        ? "This PDF has no readable text layer. Review every original page manually for markings and personal information."
        : "Text-layer inspection cannot read text inside scanned images. Review the original PDF pages.",
  );
  return review;
}

/** Review transfer must inspect every retained field, including labels and provenance IDs. */
export function reviewPackageReviewMetadata(
  round: import("./actionPackages").PackageReviewRound | import("./actionPackages").PackageReviewApplication,
  policy: PolicyResolution,
): ExportReview {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(round);
  return reviewPackageText(strings.join("\n"), "Retained package review metadata", policy);
}
