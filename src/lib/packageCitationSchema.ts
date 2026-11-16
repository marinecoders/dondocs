import { z } from "zod";
import { paragraphIdSchema } from "./paragraphIdentity";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const capturedItem = {
  id,
  memberId: id,
  memberRevisionId: id,
  index: z.number().int().nonnegative().max(9999),
  itemSha256: sha256,
};
export const packageCitationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ ...capturedItem, kind: z.literal("reference") }).strict(),
  z.object({ ...capturedItem, kind: z.literal("native-enclosure") }).strict(),
  z.object({ id, kind: z.literal("package-enclosure"), memberId: id, memberRevisionId: id, itemSha256: sha256 }).strict(),
]);
export const packageCitationSourceSchema = z.object({
  memberId: id,
  memberRevisionId: id,
  paragraphId: paragraphIdSchema,
  field: z.enum(["text", "header"]),
  kind: z.enum(["reference", "enclosure"]),
  start: z.number().int().nonnegative().max(2_000_000),
  end: z.number().int().positive().max(2_000_000),
  textSha256: sha256,
  selectionSha256: sha256,
}).strict().refine(value => value.end > value.start && value.end - value.start <= 20, "Invalid citation range");
export const packageCitationsSchema = z.object({
  version: z.literal(1),
  targets: z.array(packageCitationTargetSchema).max(1000),
  links: z.array(z.object({ id, source: packageCitationSourceSchema, targetId: id }).strict()).max(2000),
}).strict().superRefine((value, context) => {
  const ids = [...value.targets.map(target => target.id), ...value.links.map(link => link.id)];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Duplicate citation identity" });
  const sources = new Set<string>();
  for (const link of value.links) {
    const target = value.targets.find(target => target.id === link.targetId);
    if (!target || (target.kind === "reference") !== (link.source.kind === "reference"))
      context.addIssue({ code: "custom", message: "Invalid citation target binding" });
    if (target && target.kind !== "package-enclosure" && target.memberId !== link.source.memberId)
      context.addIssue({ code: "custom", message: "A native citation must target its own member’s list" });
    const key = JSON.stringify([link.source.memberId, link.source.paragraphId, link.source.field, link.source.start, link.source.end]);
    if (sources.has(key)) context.addIssue({ code: "custom", message: "Duplicate citation occurrence" });
    sources.add(key);
  }
});
export type PackageCitationTarget = z.infer<typeof packageCitationTargetSchema>;
export type PackageCitationSource = z.infer<typeof packageCitationSourceSchema>;
export type PackageCitations = z.infer<typeof packageCitationsSchema>;
export type PackageCitationLink = PackageCitations["links"][number];
