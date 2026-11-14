import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import userEvent from "@testing-library/user-event";
import { ShareModal } from "@/components/modals/ShareModal";
import { useDocumentStore } from "@/stores/documentStore";
import { documentCapabilities } from "@/lib/documentCapabilities";
import { fixtureInstance, fixturePage } from "../_helpers/formFixture";
import { encryptSharePayload } from "@/lib/shareCrypto";
import { useDocumentsStore } from "@/stores/documentsStore";
import { useFormStore } from "@/stores/formStore";
import * as classificationConfig from "@/config/classification";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";

vi.mock("@/lib/shareCrypto", () => ({
  encryptSharePayload: vi.fn(async () => "TOKEN"),
  buildShareUrl: (token: string) => `https://example.test/#s=${token}`,
  parseShareUrl: vi.fn(),
  decryptSharePayload: vi.fn(),
  MAX_SHARE_URL_LENGTH: 8000,
  MAX_ENCRYPTED_SHARE_LENGTH: 140 * 1024 * 1024,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });
async function generate() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
  await user.type(screen.getByLabelText("Password for this link"), "password");
  await user.click(screen.getByRole("button", { name: "Generate link" }));
  return user;
}
it("rejects a configured form without verified page identities before privacy review or encryption", async () => {
  const form = fixtureInstance();
  form.answers.name = "SSN 123-45-6789";
  useDocumentStore.setState({
    documentMode: "compliant",
    documentCategory: "forms",
    docType: "naval_letter",
    formType: "fixture",
    genericForm: form,
  });
  expect(
    documentCapabilities(useDocumentStore.getState(), {
      operation: "share",
      target: "link",
    }),
  ).toMatchObject({ status: "invalid-data", reason: "invalid-definition" });
  render(<ShareModal open mode="share" onOpenChange={() => {}} />);
  await generate();
  expect(screen.getByRole("alert")).toHaveTextContent("checksums");
  expect(encryptSharePayload).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Share anyway" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: /Share link/ }),
  ).not.toBeInTheDocument();
});
it("checks and encrypts the captured configured form after privacy approval despite a later live document change", async () => {
  const form = fixtureInstance();
  const page = await fixturePage();form.definition.pages[0].sha256 = page.sha256;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/page1.pdf')
    ? new Response(new Uint8Array(page.bytes)) : new Response('', { status: 404 })));
  form.answers.name = "SSN 123-45-6789";
  useDocumentStore.setState({
    documentMode: "compliant",
    documentCategory: "forms",
    docType: "naval_letter",
    formType: "fixture",
    genericForm: form,
  });
  render(<ShareModal open mode="share" onOpenChange={() => {}} />);
  const user = await generate();
  expect(encryptSharePayload).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Share anyway" })).toBeVisible();
  useDocumentStore.setState({ formType: "unloaded", genericForm: undefined });
  await user.click(screen.getByRole("button", { name: "Share anyway" }));
  await waitFor(() => expect(encryptSharePayload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      version: 4,
      documentKind: "configured-form",
      draft: expect.objectContaining({
        formType: "fixture",
        genericForm: expect.objectContaining({
          answers: expect.objectContaining({ name: "SSN 123-45-6789" }),
        }),
      }),
      resources: expect.objectContaining({ entries: [expect.objectContaining({ sha256: page.sha256 })] }),
    }),
    "password",
  ));
  expect(
    await screen.findByRole("textbox", { name: "Share link (copied to clipboard)" }),
  ).toBeVisible();
});

it.each(["navmc_10274", "navmc_118_11"] as const)("rejects %s retained markings before encrypting image shares", async formType => {
  vi.stubGlobal("crypto", webcrypto);
  const policy = resolveExportDeploymentPolicy({ hostname: "example.test", runtime: { status: "absent" }, environment: null });
  vi.spyOn(classificationConfig, "getExportDeploymentPolicy").mockResolvedValue(policy);
  useDocumentsStore.getState().newDocument(formType);
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const blocks = [{ name: "Synthetic signer", statement: "", style: "image" as const, image }];
  if (formType === "navmc_10274") {
    useFormStore.getState().setNavmc10274Field("signatureBlocks", blocks);
    useFormStore.getState().setNavmc10274Field("supplementalInfo", "SECRET");
  } else {
    useFormStore.getState().setNavmc11811Field("signatureBlocks", blocks);
    useFormStore.getState().setNavmc11811Field("remarksText", "SECRET");
  }
  render(<ShareModal open mode="share" onOpenChange={() => {}} />);
  await generate();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("outside this deployment"));
  expect(encryptSharePayload).not.toHaveBeenCalled();
});

it.each(['answer', 'definition-label', 'unselected-option', 'retained-answer'] as const)('rejects recognized form markings in %s before encryption', async location => {
  const form = fixtureInstance(), page = await fixturePage();form.definition.pages[0].sha256 = page.sha256;
  if (location === 'answer') form.answers.name = 'SECRET';
  if (location === 'definition-label') form.definition.fields.name.label = 'SECRET';
  if (location === 'unselected-option') form.definition.fields.decision.options![1].label = 'SECRET';
  if (location === 'retained-answer') form.answers.retainedLegacyText = 'SECRET';
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/page1.pdf')
    ? new Response(new Uint8Array(page.bytes)) : new Response('', { status: 404 })));
  useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: 'fixture', genericForm: form });
  const before = useDocumentStore.getState().getSnapshot();
  render(<ShareModal open mode="share" onOpenChange={() => {}} />);await generate();
  expect(await screen.findByRole('alert')).toHaveTextContent('outside this deployment');
  expect(encryptSharePayload).not.toHaveBeenCalled();expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
});
