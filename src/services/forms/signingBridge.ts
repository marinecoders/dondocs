import { z } from 'zod';
import { portableResourceDigest } from '@/lib/portableResources';

const field = z.object({ name: z.string(), label: z.string(), signed: z.boolean(), locked: z.boolean(),
  trusted: z.boolean().nullable(), lockAction: z.string(), lockFields: z.array(z.string()) });
const inspection = z.object({ formId: z.string(), edition: z.string(), sha256: z.string(), fields: z.array(field) });
export type OfficialInspection = z.infer<typeof inspection>;
const identity = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), label: z.string() });
const endpoint = 'http://127.0.0.1:47993';

async function request(path: string, token: string | null, signal: AbortSignal, pdf?: Uint8Array, headers?: Record<string, string>) {
  if (token && path !== '/disconnect' && token !== currentSigningSession()) {
    throw new Error('This connection is no longer available for signing.');
  }
  let response: Response;
  try {
    response = await fetch(endpoint + path, { method: 'POST', mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: AbortSignal.any([signal, AbortSignal.timeout(130_000)]),
      headers: { ...(token && { Authorization: 'Bearer ' + token }), ...(pdf && { 'Content-Type': 'application/pdf' }), ...headers },
      body: pdf && new Uint8Array(pdf) });
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error('Could not reach the signing companion. Start the updated companion on this computer and allow local connections in your browser, then retry.', { cause });
  }
  // A lost acknowledgement can make a successful revocation look like a failure.
  if (path === '/disconnect' && response.status === 401) return response;
  if (!response.ok) {
    if (response.status === 401 && token && session?.token === token) clearSession();
    const detail = await response.json().catch(() => null);
    const message = typeof detail?.error === 'string' ? detail.error : '';
    if (path === '/session' && response.status === 403 && message.includes('pairing code')) {
      throw new Error('Update the signing companion to connect with native approval.');
    }
    throw new Error(message || 'The signing companion could not finish the request.');
  }
  if (token && session?.token === token) renewSession();
  return response;
}

// Grants belong to this tab and are shared by every official-form signing workspace.
const grant = z.object({ token: z.string().min(32), expiresIn: z.number().int().positive().max(900), maxAgeSeconds: z.number().int().positive().max(14_400) });
let session: { token: string; lifetime: number; expires: number; deadline: number; revoking: boolean } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function subscribeSigningSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function currentSigningSession() {
  return session && !session.revoking && session.expires > Date.now() ? session.token : null;
}

export function isDisconnectPending() {
  return session?.revoking ?? false;
}

function clearSession() {
  clearTimeout(timer);
  session = undefined;
  listeners.forEach(listener => listener());
}

function renewSession() {
  if (!session || session.revoking) return;
  clearTimeout(timer);
  const now = Date.now();
  session.expires = Math.min(now + session.lifetime, session.deadline);
  timer = setTimeout(clearSession, Math.max(0, session.expires - now));
}

let requestingApproval = false;

export async function connectSigningCompanion(signal: AbortSignal) {
  const current = currentSigningSession();
  if (current) return current;
  if (isDisconnectPending()) throw new Error('Finish disconnecting before connecting again.');
  if (requestingApproval) throw new Error('A connection request is already waiting for approval.');
  requestingApproval = true;
  try {
    const response = await request('/session', null, signal, undefined, { 'X-DonDocs-Connect': '1' });
    const result = grant.safeParse(await response.json());
    if (!result.success) throw new Error('Update the signing companion to the version with session expiry.');
    const approved = result.data;
    signal.throwIfAborted();
    session = { token: approved.token, lifetime: approved.expiresIn * 1000, expires: 0, revoking: false, deadline: Date.now() + approved.maxAgeSeconds * 1000 };
    renewSession();
    listeners.forEach(listener => listener());
    return approved.token;
  } finally {
    requestingApproval = false;
  }
}

export async function disconnectSigningCompanion(signal: AbortSignal) {
  const pending = session;
  if (!pending) return;
  pending.revoking = true;
  clearTimeout(timer);
  // A lost disconnect response leaves only revocation available until the
  // companion confirms it or the original grant reaches its hard deadline.
  timer = setTimeout(clearSession, Math.max(0, pending.deadline - Date.now()));
  listeners.forEach(listener => listener());
  await request('/disconnect', pending.token, signal);
  if (session === pending) clearSession();
}

export async function signingIdentities(token: string, signal: AbortSignal) {
  return z.array(identity).parse(await (await request('/identities', token, signal)).json());
}

// Transfer files cannot supply trust decisions. Re-inspect the exact bytes on this device.
// Only a digest-checked local inspection may supply signing or lock status.
type InspectedSlot = Readonly<Omit<OfficialInspection['fields'][number], 'lockFields'> & { lockFields: readonly string[] }>;
const inspectedFields = new Map<string, { trusted: ReadonlySet<string>; slots: readonly InspectedSlot[] }>();
export function inspectedOfficialSignatureSlots(sha256: string) {
  return inspectedFields.get(sha256)?.slots;
}
export function hasInspectedSignature(sha256: string, field: string) {
  return inspectedFields.get(sha256)?.trusted.has(field) === true;
}
export async function inspectOfficialPdf(bytes: Uint8Array, token: string, signal: AbortSignal, base?: { length: number; sha256: string }) {
  const result = inspection.parse(await (await request(base ? '/return' : '/inspect', token, signal, bytes,
    base && { 'X-Base-Length': String(base.length), 'X-Base-SHA256': base.sha256 })).json());
  if (result.sha256 !== await portableResourceDigest(new Uint8Array(bytes).buffer)) throw new Error('The bridge inspected a different PDF revision.');
  const signed = result.fields.filter(field => field.signed);
  inspectedFields.set(result.sha256, {
    trusted: new Set(signed.every(field => field.trusted) ? signed.map(field => field.name) : []),
    slots: Object.freeze(result.fields.map(slot => Object.freeze({ ...slot, lockFields: Object.freeze([...slot.lockFields]) }))),
  });
  return result;
}

export async function signOfficialPdf(bytes: Uint8Array, field: string, certificate: string, finalize: boolean, token: string, signal: AbortSignal) {
  const response = await request('/sign', token, signal, bytes, { 'X-Field': field, 'X-Certificate': certificate, 'X-Finalize': String(finalize) });
  if (response.headers.get('Content-Type') !== 'application/pdf') throw new Error('The bridge did not return a signed PDF.');
  return new Uint8Array(await response.arrayBuffer());
}
