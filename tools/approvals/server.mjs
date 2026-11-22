import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ApprovalError, openJournal } from './journal.mjs';

const MAX_REQUEST_BYTES = 8192;
const routePath = /^\/approvals\/([0-9a-f-]{36})$/;

async function readJson(request) {
  // An allowlisted browser uses a simple CORS request so its TLS client
  // certificate can be selected on the actual request across browser engines.
  const expectedType = request.headers.origin ? 'text/plain' : 'application/json';
  if (request.headers['content-type']?.split(';', 1)[0] !== expectedType) {
    throw new ApprovalError(415, 'Unsupported approval request content type.');
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

const browserOrigin = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value;
}, 'Use an exact HTTPS browser origin without a trailing slash.');

export function createApprovalServer({ journal, key, cert, ca, crl, browserOrigins = [] }) {
  const allowedOrigins = new Set(z.array(browserOrigin).max(8).parse(browserOrigins));
  return createServer({ key, cert, ca, crl, requestCert: true, rejectUnauthorized: true,
    minVersion: 'TLSv1.2', requestTimeout: 10_000, headersTimeout: 5000, maxHeaderSize: 8192,
  }, async (request, response) => {
    try {
      const origin = request.headers.origin;
      response.setHeader('Vary', 'Origin');
      if (origin !== undefined) {
        if (!allowedOrigins.has(origin)) throw new ApprovalError(403, 'This browser origin is not authorized.');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      const peer = request.socket.getPeerCertificate();
      const actor = request.socket.authorized && journal.actorForCertificate(peer.fingerprint256);
      if (!actor) throw new ApprovalError(403, 'This certificate is not provisioned.');
      const match = routePath.exec(request.url ?? '');
      if (request.method === 'GET' && request.url === '/approvals/session') {
        send(response, 200, journal.session(actor));
      } else if (request.method === 'POST' && request.url === '/approvals') {
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
  browserOrigins: z.array(browserOrigin).max(8).default([]),
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
  const server = createApprovalServer({ journal, key, cert, ca, crl, browserOrigins: config.browserOrigins });
  server.setTimeout(10_000, socket => socket.destroy());
  server.listen(config.port, config.host, () => console.log(`Approval service listening on ${config.host}:${config.port}`));
}
