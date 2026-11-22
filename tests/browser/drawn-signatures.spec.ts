import { openPackageWorkspace, newPackage, expandPackageTools, packageTool } from './_helpers/packageWorkspace';
import { capturePackageDocument } from '../_helpers/capturePackageDocument';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chrome-ios', 'iOS Chrome uses a separate PDF handoff window.');
  page.setDefaultTimeout(30_000);
});

async function exportDraft(page: Page) {
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export draft (.json)', exact: true }).click();
  return JSON.parse(await readFile((await (await saving).path())!, 'utf8'));
}

for (const theme of ['light', 'dark', 'classic']) {
  test(`${theme}: draw, undo, clear, cancel, and retain the actual signature in portable, Word and PDF output`, async ({ page, browserName, isMobile }, testInfo) => {
    await page.addInitScript(theme => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { theme, editorLayout: 'scroll' }, version: 1 }));
    }, theme);
    await page.goto('/');
    const draft = { documentCategory: 'correspondence', documentMode: 'custom', docType: 'business_letter',
      formData: { subject: 'DRAWN SIGNATURE CHECK', to: 'Training Office', date: 'November 21, 2026', sigFirst: 'Alex', sigLast: 'Example', signatureType: 'image' },
      paragraphs: [{ text: 'This fictional letter tests a handwritten signature.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] };
    await page.getByLabel('Import draft file').setInputFiles({ name: 'signature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const signatureSection = page.getByRole('button', { name: /^Signature Block/ });
    if (await signatureSection.count()) await signatureSection.click();
    await page.getByRole('button', { name: 'Draw signature', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Draw signature', exact: true });
    const pad = dialog.getByRole('application', { name: 'Signature drawing area' });
    const use = dialog.getByRole('button', { name: 'Use signature', exact: true });
    await expect(use).toBeDisabled();
    const box = (await pad.boundingBox())!;
    // Native input exercises pointer capture rather than dispatching synthetic DOM events.
    async function draw() {
      const points = [[0.15, 0.62], [0.25, 0.25], [0.35, 0.7], [0.48, 0.33], [0.61, 0.65], [0.82, 0.38]];
      if (isMobile && browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        for (let i = 0; i < points.length; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: i === 0 ? 'touchStart' : 'touchMove', touchPoints: [{ x: box.x + box.width * points[i][0], y: box.y + box.height * points[i][1] }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1]);
        await page.mouse.down();
        for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 3 });
        await page.mouse.up();
      }
    }
    await draw();
    await expect(use).toBeEnabled();
    await dialog.getByRole('button', { name: 'Undo stroke' }).click();
    await expect(use).toBeDisabled();
    await draw();
    await dialog.getByRole('button', { name: 'Clear drawing' }).click();
    await expect(use).toBeDisabled();
    await draw();
    if (!isMobile && browserName === 'chromium') {
      const pen = await page.context().newCDPSession(page);
      await pad.evaluate(area => area.addEventListener('pointerdown', event => area.setAttribute('data-test-pointer-type', (event as PointerEvent).pointerType), { once: true }));
      const x = box.x + box.width * 0.3, y = box.y + box.height * 0.83;
      await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.5 });
      await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + box.width * 0.4, y: y - 5, buttons: 1, pointerType: 'pen', force: 0.5 });
      await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + box.width * 0.4, y: y - 5, button: 'left', buttons: 0, pointerType: 'pen' });
      await expect(pad).toHaveAttribute('data-test-pointer-type', 'pen');
      await pen.detach();
    }
    await page.screenshot({ path: testInfo.outputPath(`signature-${theme}.png`) });
    await use.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('drawn-signature.png', { exact: true })).toBeVisible();
    const saved = await exportDraft(page);
    const png = Buffer.from(saved.formData.signatureImage.data, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    expect(width).toBeGreaterThan(100); expect(width).toBeLessThanOrEqual(824);
    expect(height).toBeGreaterThan(50); expect(height).toBeLessThanOrEqual(424);
    const pixels = await page.evaluate(async base64 => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); image.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0, transparent = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i + 3] > 100 && data[i] < 40) ink++; if (data[i + 3] === 0) transparent++; }
      return { ink, transparent };
    }, saved.formData.signatureImage.data);
    expect(pixels.ink).toBeGreaterThan(500); expect(pixels.transparent).toBeGreaterThan(500);
    await page.getByRole('button', { name: 'Draw signature', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await exportDraft(page)).formData.signatureImage.data).toBe(saved.formData.signatureImage.data);
    await page.waitForTimeout(1100);
    await page.reload();
    expect((await exportDraft(page)).formData.signatureImage.data).toBe(saved.formData.signatureImage.data);
    // A fresh browser storage partition proves the portable draft carries the asset.
    const recipient = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    try {
      const receiving = await recipient.newPage();
      await receiving.addInitScript(() => localStorage.setItem('browser-test-visitor', 'returning'));
      await receiving.goto('/');
      await receiving.getByLabel('Import draft file').setInputFiles({ name: 'portable.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
      await receiving.getByRole('button', { name: 'Open as new document', exact: true }).click();
      expect((await exportDraft(receiving)).formData.signatureImage.data).toBe(saved.formData.signatureImage.data);
    } finally { await recipient.close(); }
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const savingWord = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
    const wordPath = testInfo.outputPath('drawn-signature.docx');
    await (await savingWord).saveAs(wordPath);
    const zip = await JSZip.loadAsync(await readFile(wordPath));
    const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('uint8array')));
    expect(media.some(bytes => Buffer.from(bytes).equals(png))).toBe(true);
    const preview = page.getByRole('button', { name: 'Preview', exact: true });
    let downloadPdf: () => Promise<unknown>;
    if (await preview.getAttribute('aria-haspopup') === 'dialog') {
      await preview.click();
      downloadPdf = () => page.getByRole('dialog', { name: 'PDF preview', exact: true }).getByRole('button', { name: 'Download', exact: true }).click();
    } else {
      if (await preview.getAttribute('aria-pressed') !== 'true') await preview.click();
      await expect(page.locator('.workspace-preview [title="Document preview"]').first()).toBeAttached({ timeout: 60_000 });
      downloadPdf = async () => {
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
      };
    }
    const savingPdf = page.waitForEvent('download');
    await downloadPdf();
    const pdfPath = testInfo.outputPath('drawn-signature.pdf');
    await (await savingPdf).saveAs(pdfPath);
    const pdf = await PDFDocument.load(await readFile(pdfPath));
    expect(pdf.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFRawStream
      && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      && Number(object.dict.get(PDFName.of('Width'))?.toString()) === width
      && Number(object.dict.get(PDFName.of('Height'))?.toString()) === height)).toBe(true);
    if (theme === 'light' && !isMobile && browserName === 'chromium') {
      const workspace = await openPackageWorkspace(page);
      await newPackage(workspace);
      await expandPackageTools(workspace);
      await workspace.getByRole('textbox', { name: 'Package name', exact: true }).fill('Drawn signature package');
      await workspace.getByRole('button', { name: 'Create package', exact: true }).click();
      await capturePackageDocument(workspace);
      const delivery = await packageTool(workspace, 'Word package delivery');
      await delivery.getByRole('button', { name: 'Review Word package', exact: true }).click();
      await delivery.getByRole('checkbox', { name: /^I reviewed/ }).check();
      const savingPackage = page.waitForEvent('download');
      await delivery.getByRole('button', { name: 'Download reviewed Word package', exact: true }).click();
      const packagePath = testInfo.outputPath('drawn-signature-package.zip');
      await (await savingPackage).saveAs(packagePath);
      const bundle = await JSZip.loadAsync(await readFile(packagePath));
      const manifest = JSON.parse(await bundle.file('manifest.json')!.async('string'));
      const retained = manifest.files.find((file: { purpose: string }) => file.purpose.startsWith('Unchanged visual signature'));
      expect(Buffer.from(await bundle.file(retained.path)!.async('uint8array')).equals(png)).toBe(true);
      const packagedWord = await JSZip.loadAsync(await bundle.file(manifest.mainDocument)!.async('uint8array'));
      const packagedMedia = await Promise.all(Object.values(packagedWord.files).filter(file => !file.dir && file.name.startsWith('word/media/')).map(file => file.async('nodebuffer')));
      expect(packagedMedia.some(bytes => bytes.equals(png))).toBe(true);
    }

  });
}

for (const formType of ['navmc_10274', 'navmc_118_11']) {
  test(`${formType}: draw into the existing signer block and preserve it through reload and PDF`, async ({ page }, testInfo) => {
    const key = formType === 'navmc_10274' ? 'navmc10274' : 'navmc11811';
    await page.addInitScript(() => {
      localStorage.setItem('browser-test-visitor', 'returning');
      localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
    });
    await page.goto('/');
    await page.getByLabel('Import draft file').setInputFiles({ name: 'form.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      kind: 'dondocs-draft', version: 2, documentKind: 'builtin-form', documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType,
      formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [],
      forms: { includeCoverPage: false, [key]: { signatureBlocks: [{ name: 'Synthetic signer', statement: '', style: 'image' }] } },
    })) });
    await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
    const signatures = page.getByRole('button', { name: /^Signatures/ }).first();
    if (await signatures.count() && await signatures.getAttribute('aria-expanded') === 'false') await signatures.click();
    await page.getByRole('button', { name: 'Draw signature', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Draw signature', exact: true });
    const pad = dialog.getByRole('application');
    await pad.focus();
    await page.keyboard.press('Space');
    for (let i = 0; i < 12; i++) await page.keyboard.press(i % 2 ? 'ArrowUp' : 'ArrowRight');
    await page.keyboard.press('Space');
    await dialog.getByRole('button', { name: 'Use signature', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByAltText('Signature preview').first()).toBeVisible();
    const saved = await exportDraft(page);
    const image = saved.forms[key].signatureBlocks[0].image;
    expect(image.length).toBeGreaterThan(100);
    await page.waitForTimeout(1100);
    await page.reload();
    expect((await exportDraft(page)).forms[key].signatureBlocks[0].image).toBe(image);
    const saving = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Download PDF(?:\s|$)/ }).click();
    const path = testInfo.outputPath(`${formType}-drawn.pdf`);
    await (await saving).saveAs(path);
    const pdf = await PDFDocument.load(await readFile(path));
    const png = Buffer.from(image, 'base64');
    expect(pdf.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFRawStream
      && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      && Number(object.dict.get(PDFName.of('Width'))?.toString()) === png.readUInt32BE(16)
      && Number(object.dict.get(PDFName.of('Height'))?.toString()) === png.readUInt32BE(20))).toBe(true);
  });
}

test('Word-only drawing requires an explicit signer and embeds one retained image', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('browser-test-visitor', 'returning');
    localStorage.setItem('dondocs_ui', JSON.stringify({ state: { editorLayout: 'scroll' }, version: 1 }));
  });
  await page.goto('/');
  await page.getByLabel('Import draft file').setInputFiles({ name: 'joint.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    documentCategory: 'correspondence', documentMode: 'custom', docType: 'joint_letter',
    formData: { subject: 'DRAWN JOINT SIGNATURE', from: 'Training Sender', to: 'Training Recipient', jointJuniorSigName: 'JUNIOR EXAMPLE', jointSeniorSigName: 'SENIOR EXAMPLE', signatureType: 'none' },
    paragraphs: [{ text: 'Synthetic joint signature.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [],
  })) });
  await page.getByRole('button', { name: 'Open as new document', exact: true }).click();
  const section = page.getByRole('region', { name: 'Word signature image', exact: true });
  await expect(section.getByRole('button', { name: 'Draw signature' })).toBeDisabled();
  await section.getByLabel('Signature image signer', { exact: true }).selectOption('senior');
  await section.getByRole('button', { name: 'Draw signature' }).click();
  const dialog = page.getByRole('dialog', { name: 'Draw signature', exact: true });
  await dialog.getByRole('application').focus();
  await page.keyboard.press('Space');
  for (let i = 0; i < 12; i++) await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowDown');
  await page.keyboard.press('Space');
  await dialog.getByRole('button', { name: 'Use signature', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await exportDraft(page);
  expect(saved.formData.signatureImageSigner).toBe('senior');
  const png = Buffer.from(saved.formData.signatureImage.data, 'base64');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download Word (.docx)', exact: true }).click();
  const path = testInfo.outputPath('drawn-word-only.docx');
  await (await pending).saveAs(path);
  const zip = await JSZip.loadAsync(await readFile(path));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect((xml.match(/descr="Handwritten signature image"/g) ?? []).length).toBe(1);
  const media = await Promise.all(Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && !file.dir).map(file => file.async('nodebuffer')));
  expect(media.some(bytes => bytes.equals(png))).toBe(true);
});
