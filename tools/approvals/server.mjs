import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ApprovalError, openJournal } from './journal.mjs';

const MAX_REQUEST_BYTES = 8192;
const routePath = /^\/approvals\/([0-9a-f-]{36})$/;

async function readJson(request) {
  if (request.headers['content-type']?.split(';', 1)[0] !== 'application/json') {
    throw new ApprovalError(415, 'Send an application/json request.');
  }
  const length = Number(request.headers['content-length']);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_REQUEST_BYTES) {
    throw new ApprovalError(413, 'The request body is missing or too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > length) throw new ApprovalError(413, 'The request exceeds its declared size.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new ApprovalError(400, 'The request body is not valid JSON.');
  }
}

function send(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

export function createApprovalServer({ journal, key, cert, ca, crl }) {
  return createServer({ key, cert, ca, crl, requestCert: true, rejectUnauthorized: true,
    minVersion: 'TLSv1.2', requestTimeout: 10_000, headersTimeout: 5000, maxHeaderSize: 8192,
  }, async (request, response) => {
    try {
      if (request.headers.origin) throw new ApprovalError(403, 'Use the authenticated approval client.');
      const peer = request.socket.getPeerCertificate();
      const actor = request.socket.authorized && journal.actorForCertificate(peer.fingerprint256);
      if (!actor) throw new ApprovalError(403, 'This certificate is not provisioned.');
      const match = routePath.exec(request.url ?? '');
      if (request.method === 'POST' && request.url === '/approvals') {
        send(response, 201, journal.start(actor, await readJson(request)));
      } else if (match && request.method === 'GET') {
        send(response, 200, journal.read(actor, match[1]));
      } else if (match && request.method === 'POST') {
        send(response, 200, journal.act(actor, match[1], await readJson(request)));
      } else {
        throw new ApprovalError(404, 'Endpoint not found.');
      }
    } catch (error) {
      const status = error instanceof ApprovalError ? error.status : error instanceof z.ZodError ? 422 : 500;
      send(response, status, { error: error instanceof ApprovalError ? error.message
        : status === 422 ? 'The request fields are invalid.' : 'The approval request could not be completed.' });
    }
  });
}

const configSchema = z.object({
  database: z.string().min(1),
  identities: z.string().min(1),
  key: z.string().min(1),
  cert: z.string().min(1),
  ca: z.string().min(1),
  crl: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).default(7713),
  host: z.string().min(1).default('127.0.0.1'),
}).strict();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const configPath = process.argv[2];
  if (!configPath) throw new Error('Usage: node tools/approvals/server.mjs CONFIG.json');
  const config = configSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
  const [identities, key, cert, ca, crl] = await Promise.all([
    readFile(config.identities, 'utf8').then(JSON.parse),
    readFile(config.key), readFile(config.cert), readFile(config.ca), config.crl && readFile(config.crl),
  ]);
  const journal = openJournal(config.database, identities);
  const server = createApprovalServer({ journal, key, cert, ca, crl });
  server.setTimeout(10_000, socket => socket.destroy());
  server.listen(config.port, config.host, () => console.log(`Approval service listening on ${config.host}:${config.port}`));
}
