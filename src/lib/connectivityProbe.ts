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
 * `fetchImpl` is injectable so the two-request sequence can be driven in a
 * test without a network or a live server.
 */
export async function runProbe(
  url: string,
  token?: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeResult> {
  const started = performance.now();
  const since = () => Math.round(performance.now() - started);

  try {
    const response = await fetchImpl(url, {
      // A bearer token makes this a preflighted request, which is the case
      // worth testing: it is the one a real API call would make.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
    const error = primaryError instanceof Error ? primaryError.message : String(primaryError);
    let originResolved = false;
    try {
      // GET with no headers on purpose: `no-cors` strips anything that would
      // preflight, so asking for more here would only fail for a second
      // reason and muddy the answer. Reachability is all this needs.
      await fetchImpl(new URL(url).origin, { mode: 'no-cors' });
      originResolved = true;
    } catch {
      // Leave it false. Both attempts failing is itself the finding.
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
