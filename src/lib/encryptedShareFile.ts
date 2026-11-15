import { z } from "zod";
import { MAX_ENCRYPTED_SHARE_LENGTH } from "./shareCrypto";

export const MAX_ENCRYPTED_SHARE_FILE_BYTES = MAX_ENCRYPTED_SHARE_LENGTH + 1024;
const schema = z.object({
  kind: z.literal("dondocs-encrypted-share"),
  version: z.literal(1),
  payload: z.string().min(1).max(MAX_ENCRYPTED_SHARE_LENGTH),
}).strict();

export function parseEncryptedShareFile(json: string): string {
  if (new TextEncoder().encode(json).byteLength > MAX_ENCRYPTED_SHARE_FILE_BYTES)
    throw new Error("This encrypted share file exceeds the transfer limit.");
  const parsed = schema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error("Choose an encrypted share file downloaded from DonDocs.");
  return parsed.data.payload;
}

export function serializeEncryptedShareFile(payload: string): Uint8Array {
  const value = schema.parse({ kind: "dondocs-encrypted-share", version: 1, payload });
  return new TextEncoder().encode(JSON.stringify(value));
}
