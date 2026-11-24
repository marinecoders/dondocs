const editorDocumentPolicy = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

// The hash values pin the inline theme, boot-recovery and structured-data
// and release-recovery blocks. Older immutable entries retain the
// framing protection and report execution issues without blocking boot.
const candidatePolicy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'"
    + " 'sha256-1XMnl6saKTqRZ8eRU0pet83Zifo4tPepD8E0YTlZNUo='"
    + " 'sha256-FJYdr+LshcMQQAd4r/uL6PHCD3f/aIBU/EHBVvUb2I8='"
    + " 'sha256-4ZQilX9c8NxE2ieVN/pJvjYSSOMc7jdRCnciyFecQkA='"
    + " 'sha256-BnNfIm80v3B9cB+stlZWx7cBLeUJsyZq8rk4MTQlhxE='"
    + " 'sha256-UVwyHClinj/Z1DopEPfAbpI88Cj8spuvAQWPma/EzDQ='",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob:",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
  editorDocumentPolicy,
].join('; ');

// Exact HTML routing preserves immutable entry URLs. Only the root needs an index lookup.
export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url);
    if (url.pathname === '/') url.pathname = '/index.html';
    const response = await env.ASSETS.fetch(new Request(url, request));
    if (!/^\/(?:releases\/[^/]+\/)?index\.html$/.test(url.pathname)) return response;
    if (response.status !== 304 && !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/html')) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Frame-Options', 'DENY');
    const currentDocument = url.pathname === '/index.html';
    headers.set('Content-Security-Policy', currentDocument ? candidatePolicy : editorDocumentPolicy);
    if (!currentDocument) headers.set('Content-Security-Policy-Report-Only', candidatePolicy);
    headers.delete('Access-Control-Allow-Origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
