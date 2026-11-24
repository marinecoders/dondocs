import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PackageShareDialog from "@/components/PackageShareDialog";
import { ShareModal } from "@/components/modals/ShareModal";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { ActionPackage } from "@/lib/actionPackages";
import type { PreparedPackageShare } from "@/lib/actionPackageShare";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), receive: vi.fn(), encrypt: vi.fn(), deliver: vi.fn(), install: vi.fn(),
  decrypt: vi.fn(), download: vi.fn(),
}));
vi.mock("@/lib/actionPackageShare", () => ({
  preparePackageShare: mocks.prepare, prepareReceivedPackageShare: mocks.receive,
  encryptPreparedPackageShare: mocks.encrypt, packageShareDelivery: mocks.deliver,
  importPreparedPackageShare: mocks.install,
}));
vi.mock("@/lib/shareCrypto", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/shareCrypto")>()), decryptSharePayload: mocks.decrypt,
}));
vi.mock("@/lib/encoding", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/encoding")>()), triggerDownload: mocks.download,
}));
vi.mock("@/config/classification", async importOriginal => ({
  ...(await importOriginal<typeof import("@/config/classification")>()),
  getExportDeploymentPolicy: async () => ({ status: "ready", policy: {} }),
}));
const prepared: PreparedPackageShare = {
  name: "Synthetic reviewed package", revisionId: "selected-revision",
  members: [{ label: "Synthetic letter", kind: "native", role: "basic-letter" }],
  reviews: [{ member: "Synthetic original", review: { privacy: { found: false, findings: [], summary: { ssn: 0, edipi: 0, dob: 0, phone: 0, medicalKeywords: 0, emailAddresses: 0 } }, notices: ["Inspect every original PDF page."], structure: [], markingReview: false } }],
};
const record = { id: "package-local", name: "Synthetic action" } as ActionPackage;
function ImportHarness() {
  const [open, setOpen] = useState(true);
  return <ShareModal open={open} mode="import" initialPayload="encrypted-copy" onOpenChange={setOpen} />;
}
beforeEach(() => {
  vi.resetAllMocks();
  useUIStore.setState({ actionPackagesOpen: false, actionPackageSelectionId: null, actionPackageSelectionRevisionId: null });
  mocks.prepare.mockResolvedValue(prepared);mocks.receive.mockResolvedValue(prepared);
  mocks.decrypt.mockResolvedValue({ kind: "dondocs-action-package-share", version: 1 });
  mocks.encrypt.mockResolvedValue({ url: null });
  mocks.deliver.mockResolvedValue({ url: null, file: new TextEncoder().encode("encrypted") });
  mocks.install.mockResolvedValue({ id: "package-received" });
});
afterEach(cleanup);

it("requires explicit content review before encrypting and offers usable file fallback", async () => {
  const user = userEvent.setup();render(<PackageShareDialog record={record} revisionId="selected-revision" onClose={vi.fn()} />);
  await screen.findByText("Synthetic reviewed package");
  await user.type(screen.getByLabelText("Package password"), "secret-password");
  await user.selectOptions(screen.getByLabelText("Package expiration"), "hour");
  const generate = screen.getByRole("button", { name: "Generate encrypted package" });
  expect(generate).toBeDisabled();expect(mocks.encrypt).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: /^I reviewed every included member/ }));
  const before = Date.now();await user.click(generate);
  await screen.findByText(/too large for a reliable link/);
  expect(mocks.encrypt).toHaveBeenCalledWith(prepared, "secret-password", expect.any(Number));
  expect(mocks.encrypt.mock.calls[0][2]).toBeGreaterThanOrEqual(before + 3_600_000);
  expect(screen.queryByLabelText("Package password")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Download encrypted package file" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.any(Uint8Array), "action-package-Synthetic_action.dondocs-package.encrypted.json", "application/json"));
});

it("does not deliver an encrypted copy after its delivery policy or deadline is rejected", async () => {
  const user = userEvent.setup();render(<PackageShareDialog record={record} revisionId="selected-revision" onClose={vi.fn()} />);
  await screen.findByText("Synthetic reviewed package");
  await user.type(screen.getByLabelText("Package password"), "synthetic-password");
  await user.click(screen.getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(screen.getByRole("button", { name: "Generate encrypted package" }));
  await screen.findByRole("button", { name: "Download encrypted package file" });
  mocks.deliver.mockRejectedValue(new Error("This share link has expired."));
  await user.click(screen.getByRole("button", { name: "Download encrypted package file" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");expect(mocks.download).not.toHaveBeenCalled();
});

async function decryptReview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Password", { exact: true }), "synthetic-password");
  await user.click(screen.getByRole("button", { name: "Decrypt and review" }));
  await screen.findByRole("dialog", { name: "Review shared action package" });
}
it("reviews a received package before importing and opens Packages without changing the current document", async () => {
  const before = useDocumentStore.getState().formData;
  const user = userEvent.setup();render(<ImportHarness />);await decryptReview(user);
  const install = screen.getByRole("button", { name: "Open reviewed package" });
  expect(install).toBeDisabled();expect(mocks.install).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Package content review" })).toHaveTextContent("Inspect every original PDF page.");
  await user.click(screen.getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(install);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(useUIStore.getState().actionPackagesOpen).toBe(true);
  expect(useUIStore.getState().actionPackageSelectionId).toBe("package-received");
  expect(useUIStore.getState().actionPackageSelectionRevisionId).toBe("selected-revision");
  expect(useDocumentStore.getState().formData).toEqual(before);
});

it("shows an expiry crossed during review without opening or selecting a package", async () => {
  mocks.install.mockRejectedValue(new Error("This share link has expired."));
  const user = userEvent.setup();render(<ImportHarness />);await decryptReview(user);
  await user.click(screen.getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(screen.getByRole("button", { name: "Open reviewed package" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(useUIStore.getState().actionPackagesOpen).toBe(false);
});

it("aborts an in-flight package installation when the user closes its review", async () => {
  let finish!: (value: { id: string }) => void;
  mocks.install.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();render(<ImportHarness />);await decryptReview(user);
  await user.click(screen.getByRole("checkbox", { name: /^I reviewed every included member/ }));
  await user.click(screen.getByRole("button", { name: "Open reviewed package" }));
  await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce());
  const signal = mocks.install.mock.calls[0][1] as AbortSignal;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);finish({ id: "late-package" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(useUIStore.getState().actionPackagesOpen).toBe(false);
});

it("does not show an older asynchronously prepared package after its selected revision changes", async () => {
  let finish!: (value: PreparedPackageShare) => void;
  mocks.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<PackageShareDialog record={record} revisionId="old" onClose={vi.fn()} />);
  const latest = { ...prepared, name: "Latest selected package", revisionId: "new" };
  mocks.prepare.mockResolvedValue(latest);
  view.rerender(<PackageShareDialog record={record} revisionId="new" onClose={vi.fn()} />);
  await screen.findByText("Latest selected package");finish(prepared);
  await waitFor(() => expect(screen.queryByText("Synthetic reviewed package")).toBeNull());
});

it("cancels a package PDF review before any package is installed", async () => {
  let finish!: (value: PreparedPackageShare) => void;
  mocks.receive.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();render(<ImportHarness />);
  await user.type(screen.getByLabelText("Password"), "secret-password");
  await user.click(screen.getByRole("button", { name: "Decrypt and review" }));
  await waitFor(() => expect(mocks.receive).toHaveBeenCalledOnce());
  const signal = mocks.receive.mock.calls[0][2] as AbortSignal;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);finish(prepared);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.install).not.toHaveBeenCalled();
  expect(useUIStore.getState().actionPackagesOpen).toBe(false);
});
