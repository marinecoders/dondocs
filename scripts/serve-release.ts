// Exact HTML routing preserves immutable entry URLs. Only the root needs an index lookup.
export default {
  fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url);
    if (url.pathname === '/') url.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(url, request));
  },
};
