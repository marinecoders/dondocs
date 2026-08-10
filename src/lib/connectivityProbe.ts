/**
 * Can this browser reach an endpoint, and if not, why.
 *
 * A cross-origin request that a browser refuses and one that never left the
 * machine look identical from JavaScript: both reject with a bare TypeError,
 * no status, no headers. That single failure mode covers two very different
 * problems — the server declined to share its response, or nothing answered at
 * all — and the fix for each is in a different place.
 *
 * So the probe asks twice. The real request first; if it throws, a second
 * request to the same origin in `no-cors` mode. That one is sent but not
 * readable, which is the point: it resolves whenever the host answered. A
 * resolved fallback after a failed primary means the request left and came
 * back, and the browser withheld it. A failed fallback means nothing answered.
 */

/** What the browser can still see about a request it refused to hand over. */
export type ProbeVerdict = 'ok' | 'cors-blocked' | 'unreachable';

/**
 * The observations a verdict is drawn from, shaped so the impossible states
 * can't be built: the fallback only exists when the primary failed.
 */
export type ProbeOutcome =
  | { primaryResolved: true; status: number; responseType: ResponseType }
  | { primaryResolved: false; error: string; originResolved: boolean };

/** Kept pure and separate from the fetching so the reasoning is testable. */
export function classifyProbe(outcome: ProbeOutcome): ProbeVerdict {
  if (outcome.primaryResolved) return 'ok';
  return outcome.originResolved ? 'cors-blocked' : 'unreachable';
}

export interface ProbeResult {
  verdict: ProbeVerdict;
  /** Round trip for the primary request, whether it resolved or threw. */
  elapsedMs: number;
  /** Present when the response was readable. Any status counts as reachable —
   *  a 401 proves the endpoint answered, which is what is being measured. */
  status?: number;
  /** 'cors' or 'basic' means readable; 'opaque' means sent but withheld. */
  responseType?: ResponseType;
  /** Only the headers the server chose to expose. Usually a short list. */
  headers?: Record<string, string>;
  /** The browser's own words, which are vague by design but worth showing. */
  error?: string;
}

export function isProbeableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A request that is dropped rather than refused never rejects on its own, so
 * without a deadline the probe reports nothing at all — the one outcome worse
 * than a wrong verdict. Both requests share this budget, so it also bounds how
 * long the whole check can take.
 */
export const PROBE_TIMEOUT_MS = 15_000;

export interface ProbeOptions {
  /** Sent as a bearer, which is what makes the request preflight. */
  token?: string;
  /** Injectable so the two-request sequence can be driven without a network. */
  fetchImpl?: typeof fetch;
  /** Lets a caller that has stopped caring about the answer end the run. */
  signal?: AbortSignal;
  /** Overridable so a test can reach the deadline without waiting for it. */
  timeoutMs?: number;
}

export async function runProbe(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const { token, fetchImpl = fetch, signal, timeoutMs = PROBE_TIMEOUT_MS } = options;
  const started = performance.now();
  const since = () => Math.round(performance.now() - started);
  const deadline = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;

  try {
    const response = await fetchImpl(url, {
      // A bearer token makes this a preflighted request, which is the case
      // worth testing: it is the one a real API call would make.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: abort,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      verdict: classifyProbe({
        primaryResolved: true,
        status: response.status,
        responseType: response.type,
      }),
      elapsedMs: since(),
      status: response.status,
      responseType: response.type,
      headers,
    };
  } catch (primaryError) {
    // A browser's own words for a timeout vary and none of them say how long
    // it waited, which is the part a reader needs to tell a slow path from a
    // dead one.
    const timedOut = primaryError instanceof DOMException && primaryError.name === 'TimeoutError';
    const error = timedOut
      ? `No response within ${timeoutMs / 1000} s`
      : primaryError instanceof Error
        ? primaryError.message
        : String(primaryError);
    let originResolved = false;
    // Nothing left to ask once the budget is spent or the caller has gone: a
    // second request on a dead signal can only fail, and would report as
    // evidence what is really just the abort arriving twice.
    if (!abort.aborted) {
      try {
        // GET with no headers on purpose: `no-cors` strips anything that would
        // preflight, so asking for more here would only fail for a second
        // reason and muddy the answer. Reachability is all this needs.
        await fetchImpl(new URL(url).origin, { mode: 'no-cors', signal: abort });
        originResolved = true;
      } catch {
        // Leave it false. Both attempts failing is itself the finding.
      }
    }
    return {
      verdict: classifyProbe({ primaryResolved: false, error, originResolved }),
      elapsedMs: since(),
      error,
    };
  }
}

/** What each verdict means, in the terms someone troubleshooting needs. */
export const VERDICT_COPY: Record<ProbeVerdict, { title: string; detail: string }> = {
  ok: {
    title: 'Reachable',
    detail:
      'The request completed and the browser was allowed to read the response. Any status counts here, including 401 or 403 — those come from the endpoint, so it answered.',
  },
  'cors-blocked': {
    title: 'Reachable, response withheld',
    detail:
      'The request reached the host and came back, but the browser refused to hand it over because the endpoint did not permit this origin. Nothing in this app can change that; the endpoint has to send the permission.',
  },
  unreachable: {
    title: 'No answer',
    detail:
      'Nothing came back at all, so the request never got there. Name resolution, a proxy, or the certificate chain, rather than anything about permissions.',
  },
};
