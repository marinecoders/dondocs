import type { SerializedSession } from "@/stores/documentStore";
import { captureChangeReport, prepareChangeReport } from "./changeReport";
import { detectTextPII } from "@/services/pii/detector";
import { detectClassification } from "./detectClassification";
import type { PolicyResolution } from "./exportDeploymentPolicy";
import type { ExportReview } from "./preparedExport";

/** Portable/native package review includes retained inactive values and discussion text. */
export function reviewPackageNative(
  session: SerializedSession,
  title: string,
  policy: PolicyResolution,
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
  return {
    privacy: report.privacy,
    notices: [...report.notices, `Retained draft marking: ${report.marking}`],
    structure: [],
    markingReview: report.notices.length > 0,
  };
}
export function reviewPackageText(
  text: string,
  label: string,
  policy: PolicyResolution,
): ExportReview {
  if (policy.status !== "ready") throw new Error(policy.message);
  const marking = detectClassification(text).classLevel;
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
