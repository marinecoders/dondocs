import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { capturePackageDocument } from "../_helpers/capturePackageDocument";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test.use({ serviceWorkers: "block", actionTimeout: 15_000 });
test.setTimeout(150_000);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function appearance(context: BrowserContext, theme: string) {
  await context.addInitScript(value => {
    localStorage.setItem("browser-test-visitor", "returning");
    localStorage.setItem("dondocs_ui", JSON.stringify({ version: 1, state: { theme: value, editorLayout: "focused" } }));
  }, theme);
}
async function packages(page: Page) {
  const drawer = page.getByRole("dialog", { name: "Documents", exact: true });
  if (!await drawer.isVisible()) await page.getByRole("button", { name: "Open workspace", exact: true }).or(page.getByRole("button", { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole("button", { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole("dialog", { name: "Action packages", exact: true });
}
async function originalPdf(text: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  page.drawText(text, { x: 50, y: 700, font: await pdf.embedFont(StandardFonts.Helvetica), size: 12 });
  return Buffer.from(await pdf.save());
}
async function download(page: Page, prepare: string, deliver: string) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await modal.getByRole("button", { name: prepare, exact: true }).click();
  // Readiness includes asynchronous inspection of every retained PDF.
  await expect(modal.getByRole("heading", { name: prepare === "Export editable package" ? /^Editable transfer checks:/ : /^Package readiness:/ })).toBeVisible({ timeout: 30_000 });
  await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  const pending = page.waitForEvent("download");
  await modal.getByRole("button", { name: deliver, exact: true }).click();
  return readFile((await (await pending).path())!);
}
async function assemble(page: Page) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await modal.getByRole("button", { name: "Check readiness and assemble", exact: true }).click();
  await expect(modal.getByRole("heading", { name: /^Package readiness: (ready|exported)$/ })).toBeVisible();
  await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  await modal.getByRole("button", { name: "Assemble and retain PDF", exact: true }).click();
  await expect(modal.getByText(/Assembled PDF retained/)).toBeVisible();
}
async function approveReorder(page: Page) {
  const review = page.getByRole("region", { name: "Citation reorder review", exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByRole("button", { name: "Save reviewed citation reorder", exact: true })).toBeDisabled();
  await review.getByRole("checkbox", { name: /^I reviewed the proposed order/ }).check();
  await review.getByRole("button", { name: "Save reviewed citation reorder", exact: true }).click();
  await expect(review).toBeHidden();
}
async function pdfText(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try { return (await (await document.getPage(1)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" "); }
  finally { await document.destroy(); }
}

for (const theme of ["light", "dark", "classic"]) {
  test(`linked citation reorders update real output and preserve reviewed history in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
    await appearance(context, theme); await page.goto("/");
    const subject = `REORDER TRAINING ${theme}`;
    await page.getByLabel("Import draft file", { exact: true }).setInputFiles({ name: "reorder-training.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      documentMode: "custom", documentCategory: "correspondence", docType: "naval_letter",
      formData: { subject, unitLine1: "FICTIONAL TRAINING UNIT", from: "Training Office", to: "Training Officer", date: "15 Nov 26", ssic: "1000", serial: "001", classLevel: "unclassified", sigFirst: "Alex", sigLast: "Example" },
      paragraphs: [{ id: "browser-reorder-body", text: "Follow reference (a) and enclosure (1) for this fictional training action.", level: 0 }],
      references: [{ letter: "a", title: "Training source alpha" }, { letter: "b", title: "Training source beta" }], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole("button", { name: "Open as new document", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Review draft", exact: true })).toBeHidden();
    let modal = await packages(page);
    await modal.getByLabel("Package name", { exact: true }).fill(`Reorder action ${theme}`);
    await modal.getByRole("button", { name: "Create package", exact: true }).click();
    await capturePackageDocument(modal);
    await expect(modal.getByRole("heading", { name: `1. ${subject}`, exact: true })).toBeVisible();
    const signed = await originalPdf("SIGNED TRAINING ORIGINAL - EXACT BYTES");
    await modal.getByLabel("New member role", { exact: true }).selectOption("enclosure");
    await modal.getByRole("checkbox", { name: "Uploaded original is signed (preserve unchanged)", exact: true }).check();
    await modal.getByLabel("Add original PDF", { exact: true }).setInputFiles({ name: "signed-one.pdf", mimeType: "application/pdf", buffer: signed });
    await expect(modal.getByRole("heading", { name: "2. signed-one.pdf", exact: true })).toBeVisible();
    await modal.getByRole("checkbox", { name: "Uploaded original is signed (preserve unchanged)", exact: true }).uncheck();
    await modal.getByLabel("Add original PDF", { exact: true }).setInputFiles({ name: "support-two.pdf", mimeType: "application/pdf", buffer: await originalPdf("SECOND TRAINING ORIGINAL") });
    await expect(modal.getByRole("heading", { name: "3. support-two.pdf", exact: true })).toBeVisible();
    await modal.getByRole("button", { name: "Identify current references and enclosures", exact: true }).click();
    await expect(modal.getByText("4 identified targets · 0 linked citations", { exact: true })).toBeVisible();
    for (const [occurrence, target] of [[/Follow reference \(a\)/, `${subject} · reference (a): Training source alpha`], [/enclosure \(1\)/, "signed-one.pdf · package enclosure (1)"]] as const) {
      const sourceOption = modal.getByLabel("Citation occurrence", { exact: true }).getByRole("option", { name: occurrence }).first();
      await modal.getByLabel("Citation occurrence", { exact: true }).selectOption(await sourceOption.getAttribute("value") as string);
      await modal.getByLabel("Citation target", { exact: true }).selectOption({ label: target });
      await modal.getByRole("button", { name: "Save citation link", exact: true }).click();
    }
    await expect(modal.getByText("4 identified targets · 2 linked citations", { exact: true })).toBeVisible();
    await assemble(page);
    const oldPdf = await download(page, "Download retained PDF", "Download reviewed retained PDF");
    const oldPortable = JSON.parse((await download(page, "Export editable package", "Download reviewed editable package")).toString("utf8"));
    const oldRevision = oldPortable.package.currentRevisionId;
    const member = modal.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "3. support-two.pdf", exact: true }) });
    await member.getByRole("button", { name: "Move up", exact: true }).click();
    await expect(modal.getByRole("heading", { name: "3. support-two.pdf", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Citation reorder review" })).toContainText("After: Follow reference (a) and enclosure (2)");
    await approveReorder(page);
    await expect(modal.getByRole("heading", { name: "2. support-two.pdf", exact: true })).toBeVisible();
    await modal.getByRole("button", { name: "Move list item 2 up", exact: true }).click();
    await modal.getByRole("button", { name: "Review native list reorder", exact: true }).click();
    await expect(page.getByRole("region", { name: "Citation reorder review" })).toContainText("After: Follow reference (b) and enclosure (2)");
    await approveReorder(page);
    await assemble(page);
    const newPdf = await download(page, "Download retained PDF", "Download reviewed retained PDF");
    expect(await pdfText(oldPdf)).toContain("Follow reference (a) and Enclosure (1)");
    expect(await pdfText(newPdf)).toContain("Follow reference (b) and Enclosure (2)");
    const portable = await download(page, "Export editable package", "Download reviewed editable package"), packet = JSON.parse(portable.toString("utf8"));
    const currentRevision = packet.package.currentRevisionId, revision = packet.package.revisions[0];
    expect(revision.citations.links.map((link: { id: string }) => link.id)).toEqual(oldPortable.package.revisions[0].citations.links.map((link: { id: string }) => link.id));
    const signedMember = revision.members.find((value: { label: string }) => value.label === "signed-one.pdf");
    const signedEntry = packet.portableResources.entries.find((value: { path: string }) => value.path === `assets/${signedMember.original.id}`);
    expect(sha(Buffer.from(signedEntry.data, "base64"))).toBe(sha(signed));
    await modal.getByLabel("Package revision", { exact: true }).selectOption(oldRevision);
    expect(sha(await download(page, "Download retained PDF", "Download reviewed retained PDF"))).toBe(sha(oldPdf));
    await modal.getByLabel("Package revision", { exact: true }).selectOption(currentRevision);
    await page.reload(); modal = await packages(page);
    await modal.getByLabel("Saved packages", { exact: true }).selectOption(packet.package.id);
    await expect(modal.getByRole("list", { name: "Linked citation occurrences" })).toBeVisible();
    await expect(modal.getByRole("list", { name: "Linked citation occurrences" })).not.toContainText(/stale|missing/);
    expect(sha(await download(page, "Download retained PDF", "Download reviewed retained PDF"))).toBe(sha(newPdf));
    const fresh = await browser.newContext({ baseURL, serviceWorkers: "block", viewport: page.viewportSize() ?? undefined });
    try {
      await appearance(fresh, theme); const receiver = await fresh.newPage(); await receiver.goto("/");
      const received = await packages(receiver);
      await received.getByLabel("Import editable package", { exact: true }).setInputFiles({ name: "reordered-package.json", mimeType: "application/json", buffer: portable });
      await expect(received).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
      await expect(received.getByRole("list", { name: "Linked citation occurrences" })).toBeVisible();
      await expect(received.getByRole("list", { name: "Linked citation occurrences" })).not.toContainText(/stale|missing/);
      expect(sha(await download(receiver, "Download retained PDF", "Download reviewed retained PDF"))).toBe(sha(newPdf));
      const returned = JSON.parse((await download(receiver, "Export editable package", "Download reviewed editable package")).toString("utf8"));
      const original = returned.portableResources.entries.find((value: { path: string }) => value.path === signedEntry.path);
      expect(sha(Buffer.from(original.data, "base64"))).toBe(sha(signed));
      await info.attach("reorder-receipt", { body: JSON.stringify({ theme, oldRevision, currentRevision, oldPdfSha256: sha(oldPdf), newPdfSha256: sha(newPdf), originalSha256: sha(signed), citations: revision.citations }, null, 2), contentType: "application/json" });
      await info.attach("reordered-package", { body: await receiver.screenshot(), contentType: "image/png" });
    } finally { await fresh.close(); }
  });
}
