import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test.use({ serviceWorkers: "block", actionTimeout: 15_000 });
test.setTimeout(120_000);
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
async function exportPackage(page: Page) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await modal.getByRole("button", { name: "Export editable package", exact: true }).click();
  await expect(modal).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(modal.getByRole("heading", { name: /^Package readiness:/ })).toBeVisible();
  await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  const pending = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Download reviewed editable package", exact: true }).click();
  return readFile((await (await pending).path())!);
}

for (const theme of ["light", "dark", "classic"]) {
  test(`package citation identities survive reorder reload and fresh-browser transfer in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
    await appearance(context, theme);
    await page.goto("/");
    const subject = `CITATION TRAINING ${theme}`;
    await page.getByLabel("Import draft file", { exact: true }).setInputFiles({ name: "synthetic-citation-letter.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      documentMode: "custom", documentCategory: "correspondence", docType: "naval_letter",
      formData: { subject, unitLine1: "FICTIONAL TRAINING UNIT", from: "Training Office", to: "Training Officer", date: "15 Nov 26", ssic: "1000", serial: "001", classLevel: "unclassified", sigFirst: "Alex", sigLast: "Example" },
      paragraphs: [{ id: "browser-citation-body", text: "Follow reference (a) for this fictional training action.", level: 0 }],
      references: [{ letter: "a", title: "Training reference alpha" }, { letter: "b", title: "Training reference beta" }], enclosures: [], copyTos: [], distributions: [],
    })) });
    await page.getByRole("button", { name: "Open as new document", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Review draft", exact: true })).toBeHidden();
    let modal = await packages(page);
    await modal.getByLabel("Package name", { exact: true }).fill(`Citation action ${theme}`);
    await modal.getByRole("button", { name: "Create package", exact: true }).click();
    await modal.getByRole("button", { name: "Capture current document", exact: true }).click();
    await expect(modal.getByRole("heading", { name: `1. ${subject}`, exact: true })).toBeVisible();
    const signed = await originalPdf("SYNTHETIC SIGNED ORIGINAL - PRESERVE EXACT BYTES");
    await modal.getByLabel("New member role", { exact: true }).selectOption("enclosure");
    await modal.getByRole("checkbox", { name: "Uploaded original is signed (preserve unchanged)", exact: true }).check();
    await modal.getByLabel("Add original PDF", { exact: true }).setInputFiles({ name: "signed-training.pdf", mimeType: "application/pdf", buffer: signed });
    await expect(modal.getByRole("heading", { name: "2. signed-training.pdf", exact: true })).toBeVisible();
    await modal.getByRole("checkbox", { name: "Uploaded original is signed (preserve unchanged)", exact: true }).uncheck();
    await modal.getByLabel("Add original PDF", { exact: true }).setInputFiles({ name: "support-two.pdf", mimeType: "application/pdf", buffer: await originalPdf("SYNTHETIC SECOND SUPPORT") });
    await expect(modal.getByRole("heading", { name: "3. support-two.pdf", exact: true })).toBeVisible();
    await modal.getByRole("button", { name: "Identify current references and enclosures", exact: true }).click();
    await expect(modal.getByText("4 identified targets · 0 linked citations", { exact: true })).toBeVisible();
    await modal.getByLabel("Citation occurrence", { exact: true }).selectOption("0");
    await modal.getByLabel("Citation target", { exact: true }).selectOption({ label: `${subject} · reference (a): Training reference alpha` });
    await modal.getByRole("button", { name: "Save citation link", exact: true }).click();
    await expect(modal.getByText("4 identified targets · 1 linked citations", { exact: true })).toBeVisible();
    const before = JSON.parse((await exportPackage(page)).toString("utf8"));
    const member = modal.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "3. support-two.pdf", exact: true }) });
    await member.getByRole("button", { name: "Move up", exact: true }).click();
    const reorder = modal.getByRole("region", { name: "Citation reorder review", exact: true });
    await expect(reorder).toBeVisible();
    await reorder.getByRole("checkbox", { name: /^I reviewed the proposed order/ }).check();
    await reorder.getByRole("button", { name: "Save reviewed citation reorder", exact: true }).click();
    await expect(modal.getByRole("heading", { name: "2. support-two.pdf", exact: true })).toBeVisible();
    const portable = await exportPackage(page), packet = JSON.parse(portable.toString("utf8"));
    const revision = packet.package.revisions[0];
    expect(revision.citations).toEqual(before.package.revisions[0].citations);
    const signedMember = revision.members.find((value: { label: string }) => value.label === "signed-training.pdf");
    const entry = packet.portableResources.entries.find((value: { path: string }) => value.path === `assets/${signedMember.original.id}`);
    expect(sha(Buffer.from(entry.data, "base64"))).toBe(sha(signed));
    await page.reload();
    modal = await packages(page);
    await modal.getByLabel("Saved packages", { exact: true }).selectOption(packet.package.id);
    await expect(modal.getByText("4 identified targets · 1 linked citations", { exact: true })).toBeVisible();
    await expect(modal.getByRole("list", { name: "Linked citation occurrences" })).toContainText("reference (a): Training reference alpha · current");
    const fresh = await browser.newContext({ baseURL, serviceWorkers: "block", viewport: page.viewportSize() ?? undefined });
    try {
      await appearance(fresh, theme);
      const receiver = await fresh.newPage(); await receiver.goto("/");
      const received = await packages(receiver);
      await received.getByLabel("Import editable package", { exact: true }).setInputFiles({ name: "citation-action.dondocs-package.json", mimeType: "application/json", buffer: portable });
      await expect(received.getByText("4 identified targets · 1 linked citations", { exact: true })).toBeVisible();
      const returned = JSON.parse((await exportPackage(receiver)).toString("utf8"));
      expect(returned.package.revisions[0].citations).toEqual(revision.citations);
      const returnedEntry = returned.portableResources.entries.find((value: { path: string }) => value.path === entry.path);
      expect(sha(Buffer.from(returnedEntry.data, "base64"))).toBe(sha(signed));
      await info.attach("citation-roundtrip", { body: JSON.stringify({ theme, packageId: packet.package.id, citations: revision.citations, signedOriginalSha256: sha(signed) }, null, 2), contentType: "application/json" });
      await info.attach("citation-workspace", { body: await receiver.screenshot(), contentType: "image/png" });
    } finally { await fresh.close(); }
  });
}
