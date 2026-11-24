import { expect, type BrowserContext, type Page } from '@playwright/test';

export async function checkOfflineSpelling(page: Page, context: BrowserContext, url = '/', releaseId?: string) {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ version: 1, state: { editorLayout: 'focused', previewVisible: false } }));
  });
  await page.goto(url);
  if (releaseId) await expect(page.locator('meta[name="dondocs-release"]')).toHaveAttribute('content', releaseId);
  await expect.poll(() => page.evaluate(async () => {
    if (!navigator.serviceWorker.controller && !(await navigator.serviceWorker.getRegistration())?.active) return false;
    const isDictionary = (url: string) => /\/assets\/english-us-[^/?]+\.txt(?:\?|$)/.test(url);
    const release = document.querySelector<HTMLMetaElement>('meta[name="dondocs-release"]')?.content;
    if (release) {
      const state = await caches.match(`/__dd_release/${release}`, { cacheName: 'dondocs-release-meta-v1' });
      const record = await state?.json();
      const asset = record?.manifest.assets.find((item: { url: string }) => isDictionary(item.url));
      if (!asset) return false;
      const key = `/__dd_asset/${asset.sha256}`;
      return record.required.includes(key) && !!await caches.match(key, { cacheName: 'dondocs-release-files-v1' });
    }
    for (const name of await caches.keys()) {
      const assets = await (await caches.open(name)).keys();
      if (assets.some(request => isDictionary(request.url))) return true;
    }
    return false;
  }), { timeout: 90_000 }).toBe(true);
  const proofread = page.getByRole('button', { name: /^Proofread:/ });
  await expect(proofread).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/assets/english-us-')))).toBe(false);
  // The cache must also work on the first offline use in a tab without fetch interception.
  await page.evaluate(() => {
    const fetchAsset = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === 'string' && /\/assets\/english-us-/.test(input)) return Promise.reject(new Error('Dictionary network path disabled by the test.'));
      return fetchAsset(input, init);
    };
  });
  await context.setOffline(true);
  try {
    const draft = { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter', formType: 'navmc_10274',
      formData: { subject: 'SPELLING CHECK' }, paragraphs: [{ id: 'spelling-check', level: 0, text: '**Teh** ship recieved teh file.' }],
      references: [], enclosures: [], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'spelling-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    await proofread.click();
    const dialog = page.getByRole('dialog', { name: 'Proofread', exact: true });
    await expect(dialog.getByText('Check spelling: Teh', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('Check spelling: recieved', { exact: true })).toBeVisible();
    await dialog.getByRole('listitem').filter({ hasText: 'Check spelling: recieved' }).getByRole('button', { name: 'Go to Paragraphs' }).click();
    const paragraph = page.locator('[data-paragraph-id="spelling-check"] [contenteditable="true"]');
    await expect(paragraph).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('recieved');
    await paragraph.fill('The ship received the file.');
    await proofread.click();
    await expect(dialog.getByRole('heading', { name: /^Spelling/ })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
}
