import type { SerializedSession } from '@/stores/documentStore';
import { captureChangeReport, prepareChangeReport } from './changeReport';
import { detectTextPII } from '@/services/pii/detector';
import { detectClassification } from './detectClassification';
import type { PolicyResolution } from './exportDeploymentPolicy';
import type { ExportReview } from './preparedExport';

/** Portable/native package review includes retained inactive values and discussion text. */
export function reviewPackageNative(session: SerializedSession, title: string, policy: PolicyResolution): ExportReview {
  const empty = { ...session, genericForm: undefined, forms: undefined, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, reviewComments: undefined };
  const report = prepareChangeReport(captureChangeReport({ label: 'Empty', title: '', session: empty }, { label: 'Captured package member', title, session }, new Date(session.timestamp || 0).toISOString()), policy);
  return { privacy: report.privacy, notices: [...report.notices, `Retained draft marking: ${report.marking}`], structure: [], markingReview: report.notices.length > 0 };
}
export function reviewPackageText(text: string, label: string, policy: PolicyResolution): ExportReview {
  if (policy.status !== 'ready') throw new Error(policy.message);
  const marking = detectClassification(text).classLevel;
  if (!policy.policy.allowedLevels.includes(marking)) throw new Error(`${label} includes markings outside this deployment's configured levels.`);
  return { privacy: detectTextPII([{ field: label, value: text }]), notices: [], structure: [], markingReview: false };
}
