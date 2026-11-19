import { openPackagePreparation, importPackage, packageSection, packageVersion, choosePackageById, preparePackageExport, packageTool, packageHeading } from './_helpers/packageWorkspace';
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { capturePackageDocument } from "../_helpers/capturePackageDocument";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test.use({ serviceWorkers: "block", actionTimeout: 15_000 });
test.setTimeout(180_000);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function appearance(context: BrowserContext, theme: string) {
  await context.addInitScript(value => {
    localStorage.setItem("browser-test-visitor", "returning");
    localStorage.setItem("dondocs_ui", JSON.stringify({ version: 1, state: { theme: value, editorLayout: "focused" } }));
  }, theme);
}
async function packages(page: Page) {
  return openPackagePreparation(page);
}
async function originalPdf(text: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  page.drawText(text, { x: 50, y: 700, font: await pdf.embedFont(StandardFonts.Helvetica), size: 12 });
  return Buffer.from(await pdf.save());
}
async function exportPackage(page: Page) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await preparePackageExport(modal, 'editable');
  await expect(modal).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(modal.getByRole('button', { name: 'Download editable package', exact: true })).toBeEnabled();
  if (await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).isVisible()) await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  const pending = page.waitForEvent("download", { timeout: 90_000 });
  await modal.getByRole("button", { name: "Download editable package", exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function retainedPdf(page: Page) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await preparePackageExport(modal, 'saved');
  if (await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).isVisible()) await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  const pending = page.waitForEvent("download", { timeout: 90_000 });
  await modal.getByRole("button", { name: "Download reviewed retained PDF", exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function assembledPdf(page: Page) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await preparePackageExport(modal, 'pdf');
  await expect(modal.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  if (await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).isVisible()) await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  await modal.getByRole("button", { name: "Download PDF", exact: true }).click();
  await expect(modal.getByRole("status").filter({ hasText: /^PDF downloaded\./ })).toBeVisible({ timeout: 90_000 });
  return retainedPdf(page);
}
async function pdfText(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try { return (await (await pdf.getPage(1)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" "); }
  finally { await pdf.destroy(); }
}

for (const theme of ["light", "dark", "classic"]) {
  test(`broken package citations require deliberate repair before assembly in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
    await appearance(context, theme); await page.goto("/");
    const subject = `REPAIR TRAINING ${theme}`;
    await page.getByLabel("Import draft file", { exact: true }).setInputFiles({ name: "synthetic-repair-letter.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      documentMode: "custom", documentCategory: "correspondence", docType: "naval_letter",
      formData: { subject, unitLine1: "FICTIONAL TRAINING UNIT", from: "Training Office", to: "Training Officer", date: "15 Nov 26", ssic: "1000", serial: "001", classLevel: "unclassified", sigFirst: "Alex", sigLast: "Example" },
      paragraphs: [{ id: "browser-repair-body", text: "Use enclosure (1) for this fictional training action.", level: 0 }],
      references: [], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole("button", { name: "Open as new document", exact: true }).click();
    let modal = await packages(page);
    await modal.getByRole("textbox", { name: "Package name", exact: true }).fill(`Repair action ${theme}`);
    await modal.getByRole("button", { name: "Create package", exact: true }).click();
    await capturePackageDocument(modal);
    await expect((await packageHeading(modal, `1. ${subject}`))).toBeVisible();
  await packageSection(modal, 'Documents', true);
    await modal.getByLabel("New member role", { exact: true }).selectOption("enclosure");
    const signed = await originalPdf("SYNTHETIC SIGNED SECOND ORIGINAL - PRESERVE BYTES");
    const originals = [await originalPdf("SYNTHETIC FIRST ENCLOSURE"), signed, await originalPdf("SYNTHETIC THIRD ENCLOSURE")];
    for (let index = 0; index < originals.length; index++) {
      await modal.getByRole("checkbox", { name: "Uploaded original is signed (preserve unchanged)", exact: true }).setChecked(index === 1);
  await packageSection(modal, 'Documents', true);
      await modal.getByLabel("Add original PDF", { exact: true }).setInputFiles({ name: `training-${index + 1}.pdf`, mimeType: "application/pdf", buffer: originals[index] });
      await expect((await packageHeading(modal, `${index + 2}. training-${index + 1}.pdf`))).toBeVisible();
    }
    await modal.getByRole("button", { name: "Identify current references and enclosures", exact: true }).click();
    await expect(modal.getByText("3 identified targets · 0 linked citations", { exact: true })).toBeVisible();
    await modal.getByLabel("Citation occurrence", { exact: true }).selectOption("0");
    await modal.getByLabel("Citation target", { exact: true }).selectOption({ label: "training-1.pdf · package enclosure (1)" });
    await modal.getByRole("button", { name: "Save citation link", exact: true }).click();
    await packageSection(modal, 'Documents', true);
    await expect(modal.getByText("3 identified targets · 1 linked citations", { exact: true })).toBeVisible();
    const oldPdf = await assembledPdf(page);
    const before = JSON.parse((await exportPackage(page)).toString("utf8"));
    const oldRevisionId = before.package.currentRevisionId;
    const item = modal.getByRole("listitem").filter({ has: (await packageHeading(page, "2. training-1.pdf")) });
    await item.getByRole("button", { name: "Remove", exact: true }).click();
    const repair = await packageTool(modal, "Package citation repair");
    await expect(repair).toContainText("1 linked citations need repair");
    await preparePackageExport(modal, 'pdf');
  await expect(modal.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
    await expect(modal).toContainText("repair linked citation");
    await expect(modal.getByRole("button", { name: "Download PDF", exact: true })).toBeDisabled();
    const linkId = before.package.revisions[0].citations.links[0].id;
    await packageSection(modal, 'Documents', true);
    await repair.getByLabel("Link to repair", { exact: true }).selectOption(linkId);
    await repair.getByLabel("Current citation occurrence", { exact: true }).selectOption("0");
    await repair.getByLabel("Replacement citation target", { exact: true }).selectOption({ label: "training-3.pdf · package enclosure (2)" });
    await repair.getByRole("button", { name: "Review citation repair", exact: true }).click();
    await expect(repair.getByRole("region", { name: "Citation repair preview", exact: true })).toContainText("label 1 → 2");
    await expect(repair.getByRole("button", { name: "Save reviewed citation repair", exact: true })).toBeDisabled();
    await repair.getByRole("checkbox", { name: /^I reviewed the occurrence/ }).check();
    await repair.getByRole("button", { name: "Save reviewed citation repair", exact: true }).click();
    await expect(repair).toContainText("0 linked citations need repair");
    const newPdf = await assembledPdf(page);
    expect(await pdfText(newPdf)).toContain("Enclosure (2)");
    expect(await pdfText(oldPdf)).toContain("Enclosure (1)");
    const portable = await exportPackage(page), after = JSON.parse(portable.toString("utf8"));
    expect(after.package.currentRevisionId).not.toBe(oldRevisionId);
    await packageVersion(modal, oldRevisionId);
    expect(sha(await retainedPdf(page))).toBe(sha(oldPdf));
    await page.reload(); modal = await packages(page);
    await choosePackageById(modal, after.package.id);
    await packageSection(modal, 'Documents', true);
    await expect(modal.getByRole("region", { name: "Package citation repair", exact: true })).toContainText("0 linked citations need repair");
    const fresh = await browser.newContext({ baseURL, serviceWorkers: "block", viewport: page.viewportSize() ?? undefined });
    try {
      await appearance(fresh, theme); const receiver = await fresh.newPage(); await receiver.goto("/");
      const received = await packages(receiver);
      await importPackage(received, { name: "repaired-action.dondocs-package.json", mimeType: "application/json", buffer: portable });
  await packageSection(received, 'Documents', true);
      await expect(received).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
      await expect(received.getByRole("region", { name: "Package citation repair", exact: true })).toContainText("0 linked citations need repair");
      const returned = JSON.parse((await exportPackage(receiver)).toString("utf8"));
      expect(returned.package.revisions[0].citations).toEqual(after.package.revisions[0].citations);
      const original = returned.package.revisions[0].members.find((value: { label: string }) => value.label === "training-2.pdf").original;
      const resource = returned.portableResources.entries.find((value: { path: string }) => value.path === `assets/${original.id}`);
      expect(sha(Buffer.from(resource.data, "base64"))).toBe(sha(signed));
      expect(sha(await retainedPdf(receiver))).toBe(sha(newPdf));
      await info.attach("citation-repair-receipt", { body: JSON.stringify({ theme, oldRevisionId, newRevisionId: after.package.currentRevisionId, oldPdfSha256: sha(oldPdf), newPdfSha256: sha(newPdf), signedOriginalSha256: sha(signed), citations: returned.package.revisions[0].citations }, null, 2), contentType: "application/json" });
      await info.attach("citation-repair-workspace", { body: await receiver.screenshot(), contentType: "image/png" });
    } finally { await fresh.close(); }
  });
}
