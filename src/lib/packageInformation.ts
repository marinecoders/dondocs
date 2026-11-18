import { z } from "zod";
import type { ActionPackage } from "./actionPackages";

const identity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !Object.hasOwn(Object.prototype, value) && value !== "prototype", "Reserved package information identity.");
function allowedControls(value: string, multiline: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127 || code < 32 && !(multiline && [9, 10, 13].includes(code))) return false;
  }
  return true;
}
const label = z.string().trim().min(1).max(160).refine(value => allowedControls(value, false), "Use a single-line label.");
const text = z.string().max(10000).refine(value => allowedControls(value, true), "Unsupported control character.");

/** Descriptive captured provenance. A label or digest grants no live document access or authority. */
export const packageFactSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entered") }).strict(),
  z.object({
    kind: z.literal("document"), label, field: label,
    capturedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
]);
export type PackageFactSource = z.infer<typeof packageFactSourceSchema>;

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
const factCommon = { id: identity, label, participantId: identity.optional(), source: packageFactSourceSchema };
export const packageFactSchema = z.discriminatedUnion("kind", [
  z.object({ ...factCommon, kind: z.literal("text"), value: text }).strict(),
  z.object({ ...factCommon, kind: z.literal("identifier"), value: text.min(1).max(200) }).strict(),
  z.object({ ...factCommon, kind: z.literal("date"), value: z.string().refine(realDate, "Use a real date in YYYY-MM-DD format.") }).strict(),
  // Keep decimal values lexical. Converting an identifier or decimal through Number loses information.
  z.object({ ...factCommon, kind: z.literal("decimal"), value: z.string().max(100).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/) }).strict(),
  z.object({ ...factCommon, kind: z.literal("boolean"), value: z.boolean() }).strict(),
]);
export type PackageFact = z.infer<typeof packageFactSchema>;
export const packageParticipantSchema = z.object({
  id: identity, label, role: z.enum(["subject", "requester", "approver", "other"]),
}).strict();
export type PackageParticipant = z.infer<typeof packageParticipantSchema>;

export const packageInformationSchema = z.object({
  version: z.literal(1),
  participants: z.array(packageParticipantSchema).max(100),
  facts: z.array(packageFactSchema).max(200),
}).strict().superRefine((information, ctx) => {
  const participants = new Set<string>(), facts = new Set<string>();
  for (const participant of information.participants) {
    if (participants.has(participant.id)) ctx.addIssue({ code: "custom", message: "Duplicate package participant identity." });
    participants.add(participant.id);
  }
  for (const fact of information.facts) {
    if (facts.has(fact.id)) ctx.addIssue({ code: "custom", message: "Duplicate package fact identity." });
    facts.add(fact.id);
    if (fact.participantId && !participants.has(fact.participantId))
      ctx.addIssue({ code: "custom", message: "A package fact refers to an unavailable participant." });
  }
  if (new TextEncoder().encode(JSON.stringify(information)).byteLength > 256 * 1024)
    ctx.addIssue({ code: "custom", message: "Package information exceeds the 256 KB limit." });
});
export type PackageInformation = z.infer<typeof packageInformationSchema>;
export const MAX_PACKAGE_INFORMATION_HISTORY_BYTES = 8 * 1024 * 1024;

/** Include labels, identifiers and captured provenance in deployment/privacy review, not just displayed values. */
export function packageInformationText(value: PackageInformation): string {
  const information = packageInformationSchema.parse(value), strings: string[] = [];
  const collect = (item: unknown): void => {
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === "object") Object.values(item).forEach(collect);
  };
  collect(information);
  return strings.join("\n");
}

/** Information changes publish a child revision; prior captures and their output bytes stay untouched. */
export async function updatePackageInformation(
  input: ActionPackage,
  information: PackageInformation | undefined,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
): Promise<ActionPackage> {
  signal?.throwIfAborted();
  // Zod owns this bounded projection before a caller's new information is cloned into history.
  const captured = information === undefined ? undefined : packageInformationSchema.parse(information);
  const { actionPackageSchema, commitActionPackage, getPackageRevision, newPackageId } = await import("./actionPackages");
  const record = actionPackageSchema.parse(structuredClone(input));
  if (record.archived) throw new Error("Reopen this archived package before editing its information.");
  if (record.reviewRounds?.some(round => round.ownerPackageId === undefined))
    throw new Error("A reviewer copy cannot change captured package information.");
  const current = getPackageRevision(record);
  const factIds = new Set(captured?.facts.map(fact => fact.id));
  const priorFactIds = new Set(current.information?.facts.map(fact => fact.id));
  if (current.bindings?.items.some(binding => priorFactIds.has(binding.factId) && !factIds.has(binding.factId)))
    throw new Error("Detach or repair linked fields before removing their package values.");
  if (JSON.stringify(current.information ?? null) === JSON.stringify(captured ?? null))
    throw new Error("Package information already matches this revision.");
  const revision = { ...structuredClone(current), id: newPackageId("revision"), parentId: current.id,
    createdAt: Date.now(), information: captured, outputs: [] };
  return commitActionPackage(record, { ...record, sequence: record.sequence + 1,
    currentRevisionId: revision.id, revisions: [...record.revisions, revision] }, signal, isCurrent);
}
