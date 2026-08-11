/**
 * The DonDocs companion — a loopback HTTP endpoint an agent can call.
 *
 *   npx vite-node companion/server.ts
 *   POST http://127.0.0.1:7712/generate  {v, docType, format, content, out?}
 *
 * Binds 127.0.0.1 ONLY, and that is the design rather than a default: a local
 * address skips the site proxy, the DoD CA bundle and SSPI, so the call never
 * meets the machinery that makes .mil networking hard. Putting this on a
 * routable interface would give that up.
 *
 * This file is the entry point and nothing imports it, so starting the listener
 * at module scope is safe. The request path lives in `handler.ts` precisely so
 * that tests never have to load this file to exercise it.
 */
import { createServer } from 'node:http';
import { createHandler, CONTRACT, ROOT } from './handler';
import { systemPandocVersion, VENDORED_PANDOC } from './renderDocx';
import { loadDefaults } from './letterInput';

const PORT = Number(process.env.DONDOCS_PORT ?? 7712);

// Machine defaults — unit, signer, SSIC — read once at startup. They belong to
// the box rather than the request, so an agent does not restate its own unit on
// every call. A request field still wins over anything here.
const defaults = await loadDefaults();
const server = createServer(createHandler(defaults, ROOT));

// A port collision is the most likely startup failure and usually means a second
// companion is already up — say which, rather than dying on an unhandled event.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use — another companion may be running.`);
    console.error(`Set DONDOCS_PORT to use a different one, or stop the other process.`);
    process.exit(1);
  }
  throw err;
});

// Loopback only, explicitly. Never 0.0.0.0.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`DonDocs companion on http://127.0.0.1:${PORT}  (loopback only, v${CONTRACT})`);
  console.log(`  writing under ${ROOT}`);
  void systemPandocVersion().then((v) => {
    if (!v) { console.warn('  docx unavailable: pandoc is not on PATH (pdf is unaffected)'); }
    else if (v !== VENDORED_PANDOC) { console.warn(`  docx uses system pandoc ${v}; the app vendors ${VENDORED_PANDOC} — output may differ`); }
  });
  const unit = defaults.unit?.name ?? defaults.unit?.line1;
  console.log(unit ? `  unit defaults: ${unit}` : '  no unit defaults configured (set ~/.dondocs/companion.config.json)');
});
