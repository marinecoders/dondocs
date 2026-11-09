import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  engineReady: true,
  render: vi.fn(),
  renderConfigured: vi.fn(),
  loadPage: vi.fn(),
  deliver: vi.fn(async () => true),
  release: vi.fn(),
}));
vi.mock("@/hooks", () => ({
  useLatexEngine: () => ({
    isReady: mocks.engineReady,
    compile: async () => null,
    waitForReady: async () => true,
    error: null,
  }),
  useServiceWorker: () => ({
    showUpdatePrompt: false,
    confirmUpdate() {},
    dismissUpdatePrompt() {},
  }),
  useInstallPrompt() {},
  promptInstall() {},
}));
vi.mock("@/config/classification", async () => {
  const { resolveExportDeploymentPolicy } =
    await import("@/lib/exportDeploymentPolicy");
  return {
    getExportDeploymentPolicy: async () =>
      resolveExportDeploymentPolicy({
        hostname: "example.test",
        environment: null,
        runtime: { status: "absent" },
      }),
  };
});
vi.mock("@/services/exports/configuredForms", () => ({
  renderPreparedConfiguredForm: mocks.renderConfigured,
}));
vi.mock("@/services/forms/packages", () => ({
  loadPackagePage: mocks.loadPage,
}));
vi.mock("@/services/forms/render", () => ({
  renderForm: async () => ({ bytes: new Uint8Array([1]), diagnostics: [] }),
}));
vi.mock("@/services/exports/correspondence", () => ({
  renderPreparedCorrespondence: mocks.render,
}));
vi.mock("@/utils/exportDelivery", () => ({
  openBrowserExportDelivery: () => ({
    deliver: mocks.deliver,
    release: mocks.release,
  }),
}));
vi.mock("@/services/formCatalog", () => {
  const catalog: never[] = [];
  return { useFormCatalog: () => catalog };
});
vi.mock("@/hooks/usePandocIdlePrefetch", () => ({
  usePandocIdlePrefetch() {},
}));
vi.mock("@/components/layout/FormPanel", () => ({ FormPanel: () => null }));
vi.mock("@/components/layout/Header", () => ({
  Header: ({ onDownloadPdf }: { onDownloadPdf(): void }) => (
    <button onClick={onDownloadPdf}>Export captured PDF</button>
  ),
}));
vi.mock("@/components/modals/WelcomeModal", () => ({
  WelcomeModal: () => null,
}));
vi.mock("@/components/layout/PreviewPanel", () => ({
  PreviewPanel: () => null,
}));

import App from "@/App";
import { useDocumentStore } from "@/stores/documentStore";
import { useDocumentsStore } from "@/stores/documentsStore";
import { fixtureInstance, fixturePage } from "../_helpers/formFixture";

import { useUIStore } from "@/stores/uiStore";
beforeEach(() => {
  mocks.engineReady = true;
  vi.spyOn(useDocumentsStore.getState(), "init").mockResolvedValue(true);
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentsStore.setState({
    currentId: "palette-document",
    activationEpoch: 1,
    docs: {},
  });
  useUIStore.setState({
    commandPaletteOpen: false,
    shareModal: null,
    batchModalOpen: false,
  });
  useDocumentStore.setState({
    documentMode: "compliant",
    documentCategory: "forms",
    docType: "standard_letter",
    formType: "fixture",
    genericForm: undefined,
    formData: { subject: "CAPABILITY TEST" },
    paragraphs: [],
    references: [],
    enclosures: [],
    copyTos: [],
    distributions: [],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("actual App palette tracks unavailable, loaded configured, and correspondence output capabilities", async () => {
  await act(async () => {
    render(<App />);
  });
  act(() => useUIStore.getState().setCommandPaletteOpen(true));
  expect(
    screen.getByRole("combobox", { name: "Command search" }),
  ).toBeVisible();
  for (const name of [
    /^Download PDF/,
    /^Download Word/,
    /^Create share link/,
    /^Batch generate/,
    /^Insert batch variable/,
  ])
    expect(screen.queryByRole("option", { name })).not.toBeInTheDocument();
  const form = fixtureInstance();
  form.definition.pages[0].sha256 = (await fixturePage()).sha256;
  act(() => useDocumentStore.setState({ genericForm: form }));
  expect(screen.getByRole("option", { name: /^Download PDF/ })).toBeVisible();
  expect(
    screen.getByRole("option", { name: /^Create share link/ }),
  ).toBeVisible();
  for (const name of [
    /^Download Word/,
    /^Batch generate/,
    /^Insert batch variable/,
  ])
    expect(screen.queryByRole("option", { name })).not.toBeInTheDocument();
  await act(async () =>
    useDocumentStore.setState({
      documentCategory: "correspondence",
      genericForm: undefined,
    }),
  );
  act(() => useUIStore.getState().setCommandPaletteOpen(true));
  for (const name of [
    /^Download PDF/,
    /^Download Word/,
    /^Create share link/,
    /^Batch generate/,
    /^Insert batch variable/,
  ])
    expect(screen.getByRole("option", { name })).toBeVisible();
});
