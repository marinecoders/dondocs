import { z } from 'zod';
import type { DocumentData } from '@/types/document';

const text = (maximum: number) => z.string().max(maximum);
export const jointLetterCommandSchema = z.object({
  id: text(100).min(1), name: text(256), location: text(256), code: text(40),
  ssic: text(12), serial: text(64), date: text(64), from: text(512),
  signatureName: text(256), signatureTitle: text(512), acting: z.boolean(),
}).strict();
export const jointAdditionalCommandsSchema = z.array(jointLetterCommandSchema).max(1,
  'Joint letters support two or three commands. Remove additional commands before exporting.');
export type JointLetterCommand = z.infer<typeof jointLetterCommandSchema>;

/** Figure 7-4 explicitly places a third cosigner in the middle. Larger
 * arrangements need separate layout qualification rather than silent wrapping. */
export function additionalJointCommands(data: Partial<DocumentData>): JointLetterCommand[] {
  return jointAdditionalCommandsSchema.parse(data.jointAdditionalCommands ?? []);
}

export function emptyJointCommand(): JointLetterCommand {
  return { id: crypto.randomUUID(), name: '', location: '', code: '', ssic: '', serial: '', date: '',
    from: '', signatureName: '', signatureTitle: '', acting: false };
}

export function jointLetterCommandIssues(docType: string, data: Partial<DocumentData>, requireComplete = true): string[] {
  if (docType !== 'joint_letter') return [];
  const parsed = jointAdditionalCommandsSchema.safeParse(data.jointAdditionalCommands ?? []);
  if (!parsed.success) return ['Joint letter command data is invalid. Only one additional command is supported.'];
  if (!parsed.data.length) return [];
  const issues: string[] = [];
  if (data.signatureType === 'image') issues.push('Three-command joint letters support typed signatures and digital PDF fields. Choose one of those signature styles before exporting.');
  const command = parsed.data[0];
  if (requireComplete && (!command.name.trim() || !command.from.trim() || !command.signatureName.trim())) {
    issues.push('Complete the additional command name, From line and signatory name before exporting.');
  }
  return issues;
}

export function assertJointLetterCommandSupport(docType: string, data: Partial<DocumentData>): void {
  const issues = jointLetterCommandIssues(docType, data, false);
  if (issues.length) throw new Error(issues.join(' '));
}
