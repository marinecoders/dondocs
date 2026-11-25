import { z } from 'zod';
import { portableResourceDigest } from '@/lib/portableResources';

const field = z.object({ name: z.string(), label: z.string(), signed: z.boolean(), locked: z.boolean(),
  trusted: z.boolean().nullable(), lockAction: z.string(), lockFields: z.array(z.string()) });
const inspection = z.object({ formId: z.string(), edition: z.string(), sha256: z.string(), fields: z.array(field) });
export type OfficialInspection = z.infer<typeof inspection>;
const identity = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), label: z.string() });
const endpoint = 'http://127.0.0.1:47993';

async function request(path: string, code: string, signal: AbortSignal, pdf?: Uint8Array, headers?: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(endpoint + path, { method: 'POST', mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: AbortSignal.any([signal, AbortSignal.timeout(130_000)]),
      headers: { Authorization: 'Bearer ' + code, ...(pdf && { 'Content-Type': 'application/pdf' }), ...headers },
      body: pdf && new Uint8Array(pdf) });
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error('Could not reach the local CAC bridge. Start it for this DonDocs address and retry.', { cause });
  }
  if (!response.ok) throw new Error((await response.json()).error || 'The signing bridge could not finish the request.');
  return response;
}

export async function signingIdentities(code: string, signal: AbortSignal) {
  return z.array(identity).parse(await (await request('/identities', code, signal)).json());
}

// Transfer files cannot supply trust decisions. Re-inspect the exact bytes on this device.
const inspectedFields = new Map<string, ReadonlySet<string>>();
export function hasInspectedSignature(sha256: string, field: string) {
  return inspectedFields.get(sha256)?.has(field) === true;
}
export async function inspectOfficialPdf(bytes: Uint8Array, code: string, signal: AbortSignal, base?: { length: number; sha256: string }) {
  const result = inspection.parse(await (await request(base ? '/return' : '/inspect', code, signal, bytes,
    base && { 'X-Base-Length': String(base.length), 'X-Base-SHA256': base.sha256 })).json());
  if (result.sha256 !== await portableResourceDigest(new Uint8Array(bytes).buffer)) throw new Error('The bridge inspected a different PDF revision.');
  const signed = result.fields.filter(field => field.signed);
  inspectedFields.set(result.sha256, new Set(signed.every(field => field.trusted) ? signed.map(field => field.name) : []));
  return result;
}

export async function signOfficialPdf(bytes: Uint8Array, field: string, certificate: string, finalize: boolean, code: string, signal: AbortSignal) {
  const response = await request('/sign', code, signal, bytes, { 'X-Field': field, 'X-Certificate': certificate, 'X-Finalize': String(finalize) });
  if (response.headers.get('Content-Type') !== 'application/pdf') throw new Error('The bridge did not return a signed PDF.');
  return new Uint8Array(await response.arrayBuffer());
}
