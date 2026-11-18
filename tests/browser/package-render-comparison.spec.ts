import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const fixturePath = fileURLToPath(new URL("../fixtures/package-render/baseline-1.3.98.dondocs-package.json", import.meta.url));
const receiptPath = fileURLToPath(new URL("../fixtures/package-render/baseline-1.3.98.receipt.json", import.meta.url));
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
test.use({ serviceWorkers: "block", actionTimeout: 15_000 });
test.setTimeout(180_000);
async function appearance(context: BrowserContext, theme: string) {
  await context.addInitScript(value => {
    localStorage.setItem("browser-test-visitor", "returning");
    localStorage.setItem("dondocs_ui", JSON.stringify({ version: 1, state: { theme: value, editorLayout: "focused" } }));
  }, theme);
}
async function packages(page: Page) {
  const drawer = page.getByRole("dialog", { name: "Documents", exact: true });
  if (!(await drawer.isVisible())) await page.getByRole("button", { name: "Open workspace", exact: true })
    .or(page.getByRole("button", { name: /^Packages(?:\s|$)/ })).first().click();
  if (await drawer.isVisible()) await drawer.getByRole("button", { name: /^Packages(?:\s|$)/ }).click();
  return page.getByRole("dialog", { name: "Action packages", exact: true });
}
async function importPackage(page: Page, bytes: Buffer) {
  const modal = await packages(page);
  await modal.getByLabel("Import editable package", { exact: true }).setInputFiles({ name: "synthetic.dondocs-package.json", mimeType: "application/json", buffer: bytes });
  await expect(modal).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(modal.getByRole("button", { name: "Check readiness and assemble", exact: true })).toBeVisible();
  return modal;
}
async function approve(page: Page, button: string) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await modal.getByRole("checkbox", { name: /^I reviewed every included member/ }).check();
  await modal.getByRole("button", { name: button, exact: true }).click();
}
async function download(page: Page, prepare: string, deliver: string) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await modal.getByRole("button", { name: prepare, exact: true }).click();
  await expect(modal).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(modal.getByRole("heading", { name: /^Package readiness:/ })).toBeVisible();
  const pending = page.waitForEvent("download");
  await approve(page, deliver);
  return readFile((await (await pending).path())!);
}
async function compare(page: Page) {
  const modal = page.getByRole("dialog", { name: "Action packages", exact: true });
  await modal.getByRole("button", { name: "Review PDF comparison", exact: true }).click();
  await expect(modal).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(modal.getByRole("heading", { name: /^Package readiness:/ })).toBeVisible();
  await approve(page, "Compare reviewed retained PDFs");
  const result = modal.getByRole("region", { name: "Retained PDF comparison", exact: true });
  await expect(result).toBeVisible({ timeout: 60_000 });
  return result;
}
function resource(packet: { portableResources: { entries: Array<{ path: string; data: string }> } }, id: string) {
  const entry = packet.portableResources.entries.find(value => value.path === `assets/${id}`);
  expect(entry).toBeTruthy();
  return Buffer.from(entry!.data, "base64");
}

for (const theme of ["light", "dark", "classic"]) test(`v1.3.98 saved inputs re-render, compare, reload and transfer in ${theme}`, async ({ page, context, browser, baseURL }, info) => {
  await appearance(context, theme);
  await page.goto("/");
  const fixture = await readFile(fixturePath), receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  let modal = await importPackage(page, fixture);
  const originalPacket = JSON.parse(fixture.toString("utf8")), oldOutput = originalPacket.package.revisions[0].outputs[0];
  const originalAsset = originalPacket.package.revisions[0].members.find((member: { kind: string }) => member.kind === "original").original;
  expect(sha(await download(page, "Download retained PDF", "Download reviewed retained PDF"))).toBe(receipt.retainedSha256);
  await modal.getByRole("button", { name: "Check readiness and assemble", exact: true }).click();
  await expect(modal).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(modal.getByRole("heading", { name: /^Package readiness: (ready|exported)$/, exact: true })).toBeVisible();
  await approve(page, "Assemble and retain PDF");
  await expect(modal.getByRole("status").filter({ hasText: /^Assembled PDF retained\./ })).toContainText("Assembled PDF retained.", { timeout: 90_000 });
  const result = await compare(page);
  await expect(result.getByText("Unavailable for a legacy output", { exact: true })).toBeVisible();
  for (const metric of ["Extracted text", "Text layout", "Page geometry", "Member boundaries and numbering"])
    await expect(result.locator("dt").filter({ hasText: new RegExp(`^${metric}$`) }).locator("+ dd")).toHaveText("Match");
  await expect(result).toContainText("do not establish visual equivalence");
  const transferred = await download(page, "Export editable package", "Download reviewed editable package"), packet = JSON.parse(transferred.toString("utf8"));
  const revision = packet.package.revisions[0];
  expect(revision.id).toBe(receipt.revisionId);
  expect(revision.outputs).toHaveLength(2);
  expect(revision.outputs[0]).toEqual(oldOutput);
  expect(sha(resource(packet, oldOutput.asset.id))).toBe(receipt.retainedSha256);
  expect(sha(resource(packet, originalAsset.id))).toBe(receipt.originalSha256);
  expect(revision.outputs[1].provenance.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(revision.outputs[1].provenance.applicationVersion).not.toBe("1.3.98");
  await info.attach("cross-release-receipt", { body: JSON.stringify({ baseline: receipt.sourceHead, currentVersion: revision.outputs[1].provenance.applicationVersion, beforeSha: oldOutput.asset.sha256, afterSha: revision.outputs[1].asset.sha256, observed: await result.innerText() }, null, 2), contentType: "application/json" });
  await page.reload();
  modal = await packages(page);
  await modal.getByLabel("Saved packages", { exact: true }).selectOption(packet.package.id);
  await compare(page);
  const fresh = await browser.newContext({ baseURL, serviceWorkers: "block" });
  try {
    await appearance(fresh, theme);
    const other = await fresh.newPage();
    await other.goto("/");
    await importPackage(other, transferred);
    await compare(other);
    const restored = JSON.parse((await download(other, "Export editable package", "Download reviewed editable package")).toString("utf8"));
    expect(sha(resource(restored, oldOutput.asset.id))).toBe(receipt.retainedSha256);
    expect(sha(resource(restored, originalAsset.id))).toBe(receipt.originalSha256);
    expect(sha(await download(other, "Download retained PDF", "Download reviewed retained PDF"))).toBe(revision.outputs[1].asset.sha256);
    await info.attach("restored-comparison", { body: await other.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally { await fresh.close(); }
});

type Control = "metadata" | "vector" | "font" | "text" | "position" | "size" | "rotation" | "crop" | "no-text";
async function controlPdf(control: Control | "baseline") {
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  if (control !== "no-text") page.drawText(control === "text" ? "CHANGED SYNTHETIC TEXT" : "SYNTHETIC TEXT", {
    x: control === "position" ? 70 : 50, y: 700, size: 12,
    font: await pdf.embedFont(control === "font" ? StandardFonts.Courier : StandardFonts.Helvetica),
  });
  page.drawRectangle({ x: 50, y: 500, width: 50, height: 50, color: control === "vector" ? rgb(1, 0, 0) : rgb(0, 0, 1) });
  if (control === "metadata") pdf.setTitle("Different metadata only");
  if (control === "size") page.setSize(700, 792);
  if (control === "rotation") page.setRotation(degrees(90));
  if (control === "crop") page.setCropBox(10, 10, 580, 760);
  return Buffer.from(await pdf.save());
}
async function controlPackage(control: Control) {
  const baseline = await controlPdf(control === "no-text" ? "no-text" : "baseline"), changed = await controlPdf(control);
  const asset = (id: string, bytes: Buffer) => ({ id, name: `${id}.pdf`, type: "application/pdf", size: bytes.length, sha256: sha(bytes) });
  const original = asset("control-original", baseline), before = asset("control-before", baseline), after = asset("control-after", changed);
  const output = (id: string, value: typeof before, time: number) => ({ id, createdAt: time, asset: value, renderer: "Synthetic negative control", policyIdentity: "synthetic", boundaries: [{ memberId: "control-member", startPage: 1, pageCount: 1, firstPageLabel: "1", numbering: "continuation" }], signingStatus: "unsigned-assembled-derivative" });
  return Buffer.from(JSON.stringify({ kind: "dondocs-action-package", version: 1,
    package: { kind: "dondocs-action-package-record", version: 1, id: `control-package-${control}`, name: `Synthetic ${control}`, archived: false, sequence: 0, currentRevisionId: "control-revision",
      revisions: [{ id: "control-revision", createdAt: 1, members: [{ id: "control-member", revisionId: "control-member-revision", role: "basic-letter", required: true, label: "Synthetic original", kind: "original", signedOriginal: false, original }], outputs: [output("control-before-output", before, 1), output("control-after-output", after, 2)] }] },
    portableResources: { kind: "dondocs-resources", version: 1, entries: [[original, baseline], [before, baseline], [after, changed]].map(([value, bytes]) => {
      const entry = value as typeof original;
      return { path: `assets/${entry.id}`, name: entry.name, mediaType: entry.type, size: entry.size, sha256: entry.sha256, data: (bytes as Buffer).toString("base64") };
    }) },
  }).replaceAll("control-", `${control}-control-`));
}

test("real PDF text, font geometry, page geometry and unassessed graphics controls", async ({ page, context }, info) => {
  await appearance(context, "light");
  await page.goto("/");
  const receipts: unknown[] = [];
  for (const control of ["metadata", "vector", "font", "text", "position", "size", "rotation", "crop", "no-text"] as Control[]) {
    const modal = await importPackage(page, await controlPackage(control));
    const result = await compare(page);
    const metric = (name: string) => result.locator("dt").filter({ hasText: new RegExp(`^${name}$`) }).locator("+ dd");
    if (control !== "no-text") await expect(metric("PDF file bytes")).toHaveText("Different");
    await expect(metric("Extracted text")).toHaveText(control === "text" ? "Different" : control === "no-text" ? "Unavailable" : "Match");
    await expect(metric("Text layout")).toHaveText(["font", "text", "position"].includes(control) ? "Different" : control === "no-text" ? "Unavailable" : "Match");
    await expect(metric("Page geometry")).toHaveText(["size", "rotation", "crop"].includes(control) ? "Different" : "Match");
    await expect(result).toContainText("do not establish visual equivalence");
    receipts.push({ control, observed: await result.innerText() });
    await modal.getByRole("button", { name: "Close", exact: true }).click();
  }
  await info.attach("real-pdf-negative-controls", { body: JSON.stringify(receipts, null, 2), contentType: "application/json" });
});
