import { createExportGate } from '@/lib/exportController';
import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDFDocument } from "pdf-lib";
import { ActionPackageWorkspace } from "@/components/ActionPackageWorkspace";
import { createBlankSession } from "@/stores/documentStore";
import {
  createActionPackage,
  reviseActionPackage,
  listActionPackages,
  getPackageRevision,
} from "@/lib/actionPackages";
import { capturePackageMember } from "@/lib/actionPackageAssets";
import { captureDocumentRevision } from "@/lib/capturedDocument";
import { resolveExportDeploymentPolicy } from "@/lib/exportDeploymentPolicy";

const policy = resolveExportDeploymentPolicy({
  hostname: "localhost",
  environment: { maxLevel: "unclassified", allowedLevels: ["unclassified"] },
  runtime: { status: "absent" },
});
vi.mock("@/stores/backupStore", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/config/classification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/classification")>()),
  getExportDeploymentPolicy: async () => policy,
}));

beforeEach(() => vi.restoreAllMocks());
it("cancels a held render on close and never publishes into a reopened dialog or retains late output", async () => {
  const source = createBlankSession();
  source.formData = {
    ...source.formData,
    subject: "Synthetic cancellation",
    unitLine1: "FICTIONAL TRAINING UNIT",
    from: "Training Office",
    to: "Training Officer",
    sigLast: "Example",
    classLevel: "unclassified",
  };
  source.paragraphs = [
    {
      id: "cancellation-body",
      text: "Synthetic retained paragraph.",
      level: 0,
    },
  ];
  const captured = captureDocumentRevision(
    { documentId: "cancel-source", epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...source, endItems: [], publicationTables: {} },
  );
  const member = await capturePackageMember(
    captured,
    "Cancellation source",
    "basic-letter",
  );
  const record = await reviseActionPackage(
    await createActionPackage("Cancellation package"),
    [member],
  );
  let finish!: (bytes: Uint8Array) => void;
  const compile = vi.fn(
    () =>
      new Promise<Uint8Array>((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(
    <ActionPackageWorkspace exportGate={createExportGate()}
      ports={{ compile, convertDocx: vi.fn(), waitForReady: async () => true }}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Packages" }),
  );
  let dialog = screen.getByRole("dialog", { name: "Action packages" });
  await user.selectOptions(
    within(dialog).getByLabelText("Saved packages", { exact: true }),
    record.id,
  );
  await user.click(
    within(dialog).getByRole("button", {
      name: "Check readiness and assemble",
    }),
  );
  await within(dialog).findByRole("heading", {
    name: "Package readiness: ready",
  });
  await user.click(
    within(dialog).getByRole("checkbox", {
      name: /^I reviewed every included member/,
    }),
  );
  await user.click(
    within(dialog).getByRole("button", {
      name: "Assemble and retain PDF",
    }),
  );
  await waitFor(() => expect(compile).toHaveBeenCalledOnce());
  await user.click(
    within(dialog).getByRole("button", {
      name: "Cancel operation",
    }),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Action packages" })).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Packages" }),
  );
  dialog = screen.getByRole("dialog", { name: "Action packages" });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  finish(await pdf.save());
  await waitFor(async () =>
    expect(
      getPackageRevision(
        (await listActionPackages()).find((item) => item.id === record.id)!,
      ).outputs,
    ).toEqual([]),
  );
  await user.selectOptions(
    within(dialog).getByLabelText("Saved packages", { exact: true }),
    record.id,
  );
  expect(within(dialog).queryByTitle("Retained package PDF")).toBeNull();
  expect(within(dialog).queryByText(/Assembled PDF retained/)).toBeNull();
  expect(compile).toHaveBeenCalledOnce();
});
