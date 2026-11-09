import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareModal } from "@/components/modals/ShareModal";
import { useDocumentStore } from "@/stores/documentStore";
import { documentCapabilities } from "@/lib/documentCapabilities";
import { fixtureInstance, fixturePage } from "../_helpers/formFixture";
import { encryptSharePayload } from "@/lib/shareCrypto";

vi.mock("@/lib/shareCrypto", () => ({
  encryptSharePayload: vi.fn(async () => "TOKEN"),
  buildShareUrl: (token: string) => `https://example.test/#s=${token}`,
  parseShareUrl: vi.fn(),
  decryptSharePayload: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
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
  form.definition.pages[0].sha256 = (await fixturePage()).sha256;
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
  expect(encryptSharePayload).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      documentKind: "configured-form",
      formType: "fixture",
      genericForm: expect.objectContaining({
        answers: expect.objectContaining({ name: "SSN 123-45-6789" }),
      }),
    }),
    "password",
  );
  expect(
    screen.getByRole("textbox", { name: "Share link (copied to clipboard)" }),
  ).toBeVisible();
});
