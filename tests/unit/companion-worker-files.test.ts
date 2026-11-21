// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';

it('confines actual worker fetch and XHR reads, including fallback files and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-worker-files-'));
  const lib = join(root, 'lib');
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await mkdir(join(lib, 'texlive/pdftex/27'), { recursive: true });
    await writeFile(join(root, 'outside.txt'), 'PRIVATE_TEST_SENTINEL');
    await writeFile(join(lib, 'allowed.txt'), 'PUBLIC_ASSET');
    await writeFile(join(lib, 'texlive/pdftex/27/known.sty'), 'PUBLIC_PACKAGE');
    await symlink(join(root, 'outside.txt'), join(lib, 'linked.txt'));
    await symlink(join(root, 'outside.txt'), join(lib, 'texlive/pdftex/27/linked.sty'));
    await mkdir(join(root, 'outside-bucket'));
    await writeFile(join(root, 'outside-bucket/escaped.sty'), 'PRIVATE_TEST_SENTINEL');
    await symlink(join(root, 'outside-bucket'), join(lib, 'texlive/pdftex/28'));
    const cases = [
      { url: 'allowed.txt?version=1', fetch: 200, xhr: 200, text: 'PUBLIC_ASSET' },
      { url: 'texlive/pdftex/99/known.sty', fetch: 404, xhr: 200, text: 'PUBLIC_PACKAGE' },
      { url: '../outside.txt', fetch: 404, xhr: 404 },
      { url: 'linked.txt', fetch: 404, xhr: 404 },
      { url: 'texlive/pdftex/99/linked.sty', fetch: 404, xhr: 404 },
      { url: 'texlive/pdftex/99/escaped.sty', fetch: 404, xhr: 404 },
    ];
    await writeFile(join(lib, 'swiftlatexpdftex.js'), `
      (async () => {
        const rows = [];
        for (const value of ${JSON.stringify(cases)}) {
          const response = await fetch(value.url);
          const xhr = new XMLHttpRequest();
          xhr.open('GET', value.url); xhr.send();
          rows.push({ url: value.url, fetch: response.status, fetchText: await response.text(), xhr: xhr.status, xhrText: xhr.response ? Buffer.from(xhr.response).toString() : '' });
        }
        postMessage({ kind: 'probe', rows });
      })().catch(error => postMessage({ kind: 'probe-error', message: String(error) }));
    `);
    worker = new Worker(resolve('companion/engineWorker.mjs'), { workerData: { libDir: lib }, stdout: true, stderr: true });
    const rows = await new Promise<Array<{ url: string; fetch: number; fetchText: string; xhr: number; xhrText: string }>>((accept, reject) => {
      timer = setTimeout(() => reject(new Error('Worker file probe did not finish')), 8_000);
      worker!.on('error', reject);
      worker!.on('message', message => {
        if (message.kind === 'probe') accept(message.rows);
        if (message.kind === 'probe-error') reject(new Error(message.message));
      });
    });
    expect(rows).toHaveLength(cases.length);
    for (const expected of cases) {
      const row = rows.find(value => value.url === expected.url)!;
      expect.soft(row.fetch, `${row.url}: fetch`).toBe(expected.fetch);
      expect.soft(row.xhr, `${row.url}: XHR`).toBe(expected.xhr);
      expect.soft(row.fetchText).toBe(expected.fetch === 200 ? expected.text : '');
      expect.soft(row.xhrText).toBe(expected.xhr === 200 ? expected.text : '');
    }
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_TEST_SENTINEL');
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    await rm(root, { recursive: true, force: true });
  }
});
