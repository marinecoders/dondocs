import { execFileSync } from 'node:child_process';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openJournal } from './journal.mjs';
import { createApprovalServer } from './server.mjs';

async function fixtures(t, browserOrigins = []) {
  const directory = mkdtempSync(join(tmpdir(), 'dondocs-approvals-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const openssl = (...args) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore', timeout: 10_000 });
  openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-x509', '-days', '2', '-subj', '/CN=Synthetic Approval CA', '-keyout', 'ca.key', '-out', 'ca.pem');
  const read = file => readFileSync(join(directory, file));
  function certificate(name, serial) {
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${name}`, '-keyout', `${name}.key`, '-out', `${name}.csr`);
    openssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', String(serial), '-days', '2', '-out', `${name}.pem`);
    return { cert: read(`${name}.pem`), key: read(`${name}.key`) };
  }
  const keys = {};
  for (const [index, name] of ['localhost', 'drafter', 'chief', 'reviewer', 'unregistered'].entries()) {
    keys[name] = certificate(name, index + 1);
  }
  const actors = ['drafter', 'chief', 'reviewer'].map(id => ({
    id, fingerprint256: new X509Certificate(keys[id].cert).fingerprint256, canRequest: id === 'drafter', canApprove: id !== 'drafter',
  }));
  const database = join(directory, 'journal.sqlite');
  const journal = openJournal(database, actors);
  const ca = read('ca.pem');
  const server = createApprovalServer({ journal, ca, browserOrigins, ...keys.localhost });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    await closed;
    journal.close();
  });
  const send = (actor, method, path, body, extraHeaders = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    const req = request({ hostname: '127.0.0.1', servername: 'localhost', port: server.address().port, ca, ...keys[actor],
      agent: false, headers: { ...headers, ...extraHeaders }, method, path }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });
  return { send, database, actors };
}

test('mutual TLS assignments, exact artifact decisions, stale retries and durable history', async t => {
  const { send, database, actors } = await fixtures(t);
  const reviewArtifact = process.env.DONDOCS_APPROVAL_TEST_ARTIFACT;
  const artifact = reviewArtifact ? readFileSync(reviewArtifact) : Buffer.from('synthetic saved delivery');
  const artifactSha256 = createHash('sha256').update(artifact).digest('hex');
  const input = {
    requestId: randomUUID(),
    revision: { packageId: 'training-package', revisionId: 'saved-revision', artifactSha256 },
    assignments: [{ assignee: 'chief', dueAt: '2026-12-01T12:00:00.000Z' }, { assignee: 'reviewer' }],
  };
  assert.equal((await send('unregistered', 'POST', '/approvals', input)).status, 403);
  await assert.rejects(send('noCertificate', 'POST', '/approvals', input));
  assert.equal((await send('drafter', 'POST', '/approvals', { ...input, actorId: 'chief' })).status, 422);
  assert.equal((await send('reviewer', 'POST', '/approvals', input)).status, 403);
  const { status, data } = await send('drafter', 'POST', '/approvals', input);
  assert.equal(status, 201);
  assert.deepEqual(data.revision, input.revision);
  const repeated = await send('drafter', 'POST', '/approvals', input);
  assert.deepEqual(repeated.data, data);
  assert.equal((await send('drafter', 'POST', '/approvals', { ...input, assignments: [{ assignee: 'chief' }] })).status, 409);
  const url = `/approvals/${data.id}`;
  const decision = { action: 'approve', expectedSequence: 1, artifactSha256 };
  assert.equal((await send('reviewer', 'POST', url, decision)).status, 403);
  assert.equal((await send('chief', 'POST', url, { ...decision, artifactSha256: 'f'.repeat(64) })).status, 409);
  const competing = await Promise.all([send('chief', 'POST', url, decision), send('chief', 'POST', url, decision)]);
  assert.deepEqual(competing.map(item => item.status).sort(), [200, 409]);
  const final = await send('reviewer', 'POST', url, { ...decision, expectedSequence: 2 });
  assert.equal(final.data.status, 'approved');
  assert.equal(final.data.activeAssignment, null);
  assert.deepEqual(final.data.history.map(event => event.actorId), ['drafter', 'chief', 'reviewer']);
  for (const event of final.data.history) {
    assert.equal(event.certificateFingerprint, actors.find(actor => actor.id === event.actorId).fingerprint256);
    assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  }
  const reopened = openJournal(database, actors.filter(actor => actor.id !== 'reviewer'));
  try {
    assert.deepEqual(reopened.read('drafter', data.id), final.data);
    assert.deepEqual(reopened.start('drafter', input), final.data);
    assert.throws(() => reopened.start('drafter', { ...input, requestId: randomUUID() }), { status: 422 });
  } finally {
    reopened.close();
  }

  const returned = await send('drafter', 'POST', '/approvals', { ...input, requestId: randomUUID(), assignments: [{ assignee: 'chief' }] });
  const other = `/approvals/${returned.data.id}`;
  assert.equal((await send('reviewer', 'GET', other)).status, 404);
  const delegated = await send('drafter', 'POST', other, { action: 'delegate', expectedSequence: 1, assignee: 'reviewer' });
  assert.equal(delegated.data.activeAssignment.assignee, 'reviewer');
  assert.equal((await send('chief', 'POST', other, { ...decision, expectedSequence: 2 })).status, 403);
  const changes = await send('reviewer', 'POST', other, { ...decision, action: 'return', expectedSequence: 2 });
  assert.equal(changes.data.status, 'returned');
  assert.equal((await send('drafter', 'POST', other, { action: 'cancel', expectedSequence: 3 })).status, 409);
});

test('browser requests require an allowlisted exact HTTPS origin and a provisioned certificate', async t => {
  const origin = 'https://dondocs.example.test';
  const { send } = await fixtures(t, [origin]);
  const connected = await send('drafter', 'GET', '/approvals/session', undefined, { origin });
  assert.deepEqual(connected.data, { id: 'drafter', canRequest: true, canApprove: false });
  assert.equal(connected.headers['access-control-allow-origin'], origin);
  assert.equal(connected.headers['access-control-allow-credentials'], 'true');
  assert.equal(connected.headers.vary, 'Origin');
  const input = { requestId: randomUUID(), revision: { packageId: 'pkg', revisionId: 'rev', artifactSha256: 'a'.repeat(64) },
    assignments: [{ assignee: 'chief' }] };
  const denied = await send('drafter', 'POST', '/approvals', input, { origin: 'https://another.example.test', 'content-type': 'text/plain' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  await assert.rejects(send('noCertificate', 'POST', '/approvals', input, { origin, 'content-type': 'text/plain' }));
  assert.equal((await send('unregistered', 'GET', '/approvals/session', undefined, { origin })).status, 403);
  const created = await send('drafter', 'POST', '/approvals', input, { origin, 'content-type': 'text/plain;charset=UTF-8' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.revision, input.revision);
});
