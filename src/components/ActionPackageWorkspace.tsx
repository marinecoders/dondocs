import type { ExportGate } from '@/lib/exportController';
import { reviewPackageOriginal } from "@/lib/actionPackageDisclosure";
import type { PackageAsset } from "@/lib/actionPackages";
import type { SerializedSession } from "@/stores/documentStore";
import { useEffect, useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SessionChanges } from "./SessionChanges";
import {
  createActionPackage,
  listActionPackages,
  getPackageRevision,
  reviseActionPackage,
  renameActionPackage,
  archiveActionPackage,
  duplicateActionPackage,
  packageRoles,
  type ActionPackage,
  type NativePackageMember,
  type PackageMember,
} from "@/lib/actionPackages";
import {
  capturePackageMember,
  captureOriginalPackageMember,
  readPackageAsset,
} from "@/lib/actionPackageAssets";
import {
  assemblePackage,
  preparePackageAssembly,
  type PreparedPackageAssembly,
} from "@/lib/actionPackageAssembly";
import {
  buildPortableActionPackage,
  importPortableActionPackage,
  MAX_PACKAGE_FILE_BYTES,
} from "@/lib/actionPackageTransfer";
import {
  editPackageMember,
  savePackageWorkingCopy,
  adoptPackageSource,
} from "@/lib/actionPackageWorkingCopy";
import { captureCurrentDocumentRevision } from "@/stores/captureDocument";
import { useDocumentsStore } from "@/stores/documentsStore";
import { getExportDeploymentPolicy } from "@/config/classification";
import { triggerDownload } from "@/lib/encoding";
import type { CorrespondenceRendererPorts } from "@/services/exports/correspondence";

type Ports = CorrespondenceRendererPorts & {
  waitForReady(timeoutMs: number): Promise<boolean>;
};
export function ActionPackageWorkspace({ ports, exportGate }: { ports: Ports; exportGate: ExportGate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Packages
      </Button>
      {open && <PackageDialog ports={ports} exportGate={exportGate} onClose={() => setOpen(false)} />}
    </>
  );
}
function PackageDialog({ ports, exportGate, onClose }: { ports: Ports; exportGate: ExportGate; onClose(): void }) {
  const operation = useRef<AbortController | null>(null),
    active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
      operation.current?.abort();
    },
    [],
  );
  function assertOperationCurrent() {
    if (!active.current)
      throw new DOMException("The package dialog was closed.", "AbortError");
    operation.current?.signal.throwIfAborted();
  }
  function close() {
    operation.current?.abort();
    active.current = false;
    onClose();
  }
  const [original, setOriginal] = useState<{
    asset: PackageAsset;
    bytes: ArrayBuffer;
  } | null>(null);
  const [records, setRecords] = useState<ActionPackage[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [revisionId, setRevisionId] = useState("");
  const [name, setName] = useState(""),
    [role, setRole] = useState<PackageMember["role"]>("basic-letter"),
    [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<PreparedPackageAssembly | null>(
      null,
    ),
    [approved, setApproved] = useState(false);
  const [reviewMode, setReviewMode] = useState<
    "assemble" | "portable" | "saved" | "preview" | "original"
  >("assemble");
  const [otherReviews, setOtherReviews] = useState<PreparedPackageAssembly[]>(
    [],
  );
  const [comparison, setComparison] = useState<{
      member: NativePackageMember;
      source: SerializedSession;
    } | null>(null),
    [pdfUrl, setPdfUrl] = useState("");
  const docs = useDocumentsStore((state) => state.docs),
    currentId = useDocumentsStore((state) => state.currentId);
  const record = records.find((record) => record.id === selectedId),
    revision = record
      ? getPackageRevision(record, revisionId || record.currentRevisionId)
      : null;
  const editable =
    !!record && revision?.id === record.currentRevisionId && !record.archived;
  useEffect(() => {
    let live = true;
    void listActionPackages()
      .then((records) => {
        if (live) {
          setRecords(records);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (live) setError(error.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  function select(value: ActionPackage) {
    setSelectedId(value.id);
    setRevisionId(value.currentRevisionId);
    setName(value.name);
    setPrepared(null);
    setComparison(null);
    setPdfUrl("");
    setApproved(false);
  }
  function update(value: ActionPackage) {
    assertOperationCurrent();
    setRecords((previous) => [
      ...previous.filter((record) => record.id !== value.id),
      value,
    ]);
    select(value);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (!active.current) return;
      setError(
        controller.signal.aborted
          ? "Operation cancelled. Reopen the package to check its last complete revision."
          : error instanceof Error
            ? error.message
            : "The package operation failed.",
      );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function modify(members: PackageMember[]) {
    if (record)
      update(
        await reviseActionPackage(record, members, operation.current?.signal),
      );
  }
  async function review(mode: typeof reviewMode) {
    if (!record || !revision) return;
    const policy = await getExportDeploymentPolicy();
    if (policy.status !== "ready") throw new Error(policy.message);
    const result = await preparePackageAssembly(record, revision.id, policy);
    assertOperationCurrent();
    setOtherReviews([]);
    setReviewMode(mode);
    setPrepared(result);
    setApproved(false);
  }
  async function reviewOriginal(
    member: Extract<PackageMember, { kind: "original" }>,
  ) {
    const policy = await getExportDeploymentPolicy();
    const bytes = await readPackageAsset(member.original);
    const review = await reviewPackageOriginal(
      bytes,
      `${member.label}: ${member.original.name}`,
      policy,
    );
    assertOperationCurrent();
    setOriginal({ asset: member.original, bytes });
    setReviewMode("original");
    setOtherReviews([]);
    setApproved(false);
    setPrepared({
      revisionId: revision!.id,
      readiness: { state: "ready", findings: [] },
      reviews: [{ member: member.label, review }],
    });
  }
  async function previewAsset(asset: PackageAsset) {
    const bytes = await readPackageAsset(asset);
    assertOperationCurrent();
    setPdfUrl(
      URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
    );
  }
  async function downloadAsset(asset: PackageAsset) {
    const bytes = await readPackageAsset(asset);
    assertOperationCurrent();
    triggerDownload(new Uint8Array(bytes), asset.name, asset.type);
  }
  async function deliver() {
    if (!record || !revision || !prepared || !approved) return;
    assertOperationCurrent();
    if (reviewMode === "original") {
      if (!original) throw new Error("Review the unchanged original again.");
      triggerDownload(
        new Uint8Array(original.bytes),
        original.asset.name,
        original.asset.type,
      );
    } else if (reviewMode === "portable") {
      const json = await buildPortableActionPackage(record, revision.id);
      assertOperationCurrent();
      triggerDownload(
        new TextEncoder().encode(json),
        `${record.name.replace(/[^a-z0-9_-]/gi, "_")}.dondocs-package.json`,
        "application/json",
      );
      setNotice(
        "Editable package downloaded, including the selected revision and its original files.",
      );
    } else if (reviewMode === "preview") {
      const output = revision.outputs.at(-1);
      if (!output) throw new Error("This revision has no retained PDF.");
      await previewAsset(output.asset);
    } else if (reviewMode === "saved") {
      const output = revision.outputs.at(-1);
      if (!output)
        throw new Error("This revision has no retained assembled PDF.");
      await downloadAsset(output.asset);
      setNotice(`Retained PDF downloaded. SHA-256: ${output.asset.sha256}`);
    } else {
      const release = exportGate.acquire();
      if (!release) throw new Error('Another export is still running. Wait for it to finish before assembling this package.');
      let updated: ActionPackage;
      try { updated = await assemblePackage(prepared, ports, operation.current?.signal); } finally { release(); }
      update(updated);
      const output = getPackageRevision(updated, revision.id).outputs.at(-1)!;
      setRevisionId(revision.id);
      await previewAsset(output.asset);
      setNotice(`Assembled PDF retained. SHA-256: ${output.asset.sha256}`);
    }
    setPrepared(null);
    setApproved(false);
  }
  const comparedSource = comparison?.source;
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent className="sm:max-w-4xl" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>Action packages</DialogTitle>
          <DialogDescription>
            Preserve editable members, original files and assembled PDFs by
            revision. Linked citation relabeling and package review rounds are
            planned for a later release.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="break-all text-sm">
            {notice}
          </p>
        )}
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm">
              Package name
              <input
                aria-label="Package name"
                className="mt-1 w-full rounded border bg-background p-2"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              disabled={!loaded || !name.trim()}
              onClick={() =>
                void run(async () =>
                  update(
                    await createActionPackage(name, operation.current?.signal),
                  ),
                )
              }
            >
              Create package
            </Button>
            <label className="cursor-pointer rounded border p-2 text-sm">
              Import editable package
              <input
                aria-label="Import editable package"
                type="file"
                accept=".json"
                className="sr-only"
                disabled={!loaded || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file)
                    void run(async () => {
                      if (file.size > MAX_PACKAGE_FILE_BYTES)
                        throw new Error(
                          "Editable packages are limited to 100 MB.",
                        );
                      update(
                        await importPortableActionPackage(
                          await file.text(),
                          operation.current?.signal,
                        ),
                      );
                    });
                }}
              />
            </label>
          </div>
          <label className="block text-sm">
            Saved packages
            <select
              aria-label="Saved packages"
              className="mt-1 w-full rounded border bg-background p-2"
              value={selectedId}
              onChange={(event) => {
                const found = records.find(
                  (record) => record.id === event.target.value,
                );
                if (found) select(found);
              }}
            >
              <option value="">Choose a package</option>
              {records.map((record) => (
                <option value={record.id} key={record.id}>
                  {record.name}
                  {record.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          {record && revision && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(async () =>
                      update(
                        await renameActionPackage(
                          record,
                          name,
                          operation.current?.signal,
                        ),
                      ),
                    )
                  }
                >
                  Rename
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(async () =>
                      update(
                        await duplicateActionPackage(
                          record,
                          undefined,
                          operation.current?.signal,
                        ),
                      ),
                    )
                  }
                >
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(async () =>
                      update(
                        await archiveActionPackage(
                          record,
                          !record.archived,
                          operation.current?.signal,
                        ),
                      ),
                    )
                  }
                >
                  {record.archived ? "Reopen archived package" : "Archive"}
                </Button>
              </div>
              <label className="block text-sm">
                Package revision
                <select
                  aria-label="Package revision"
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={revision.id}
                  onChange={(event) => {
                    setRevisionId(event.target.value);
                    setPrepared(null);
                    setComparison(null);
                    setPdfUrl("");
                  }}
                >
                  {[...record.revisions].reverse().map((revision, index) => (
                    <option key={revision.id} value={revision.id}>
                      Revision {record.revisions.length - index} ·{" "}
                      {new Date(revision.createdAt).toLocaleString()}
                      {revision.id === record.currentRevisionId
                        ? " (current)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground break-all">
                Revision ID: {revision.id}. Source changes never update captured
                members automatically. Signed originals remain separate;
                assembled output has no inherited signature or approval.
              </p>
              {editable && (
                <div className="space-y-2 rounded border p-3">
                  <label className="block text-sm">
                    New member role
                    <select
                      aria-label="New member role"
                      className="ml-2 rounded border bg-background p-2"
                      value={role}
                      onChange={(event) =>
                        setRole(event.target.value as typeof role)
                      }
                    >
                      {packageRoles.map((role) => (
                        <option key={role}>{role}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        void run(async () => {
                          const captured = captureCurrentDocumentRevision();
                          const member = await capturePackageMember(
                            captured,
                            docs[currentId!]?.meta.title || "Native member",
                            role,
                          );
                          await modify([...revision.members, member]);
                        })
                      }
                    >
                      Capture current document
                    </Button>
                    <label className="cursor-pointer rounded border p-2 text-sm">
                      Add original PDF
                      <input
                        aria-label="Add original PDF"
                        type="file"
                        accept="application/pdf,.pdf"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file)
                            void run(async () => {
                              if (file.size > 25 * 1024 * 1024)
                                throw new Error(
                                  "Original files are limited to 25 MB.",
                                );
                              await modify([
                                ...revision.members,
                                await captureOriginalPackageMember(
                                  {
                                    name: file.name,
                                    data: await file.arrayBuffer(),
                                  },
                                  role,
                                  signed,
                                ),
                              ]);
                            });
                        }}
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={signed}
                      onChange={(event) => setSigned(event.target.checked)}
                    />
                    Uploaded original is signed (preserve unchanged)
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Existing native correspondence and forms, plus original
                    PDFs, are supported. Native draft files including embedded
                    assets: 25 MB each. Portable resources: 75 MB total, 256
                    entries.
                  </p>
                </div>
              )}
              <ol className="space-y-3">
                {revision.members.map((member, index) => {
                  const source =
                    member.kind === "native" &&
                    member.source?.local &&
                    docs[member.source.documentId];
                  const working = record.workingCopies?.find(
                    (copy) =>
                      copy.memberId === member.id &&
                      copy.revisionId === record.currentRevisionId,
                  );
                  return (
                    <li
                      key={member.id}
                      className="min-w-0 space-y-2 rounded border p-3"
                    >
                      <h3 className="break-words font-medium">
                        {index + 1}. {member.label}
                      </h3>
                      <p className="break-all text-xs text-muted-foreground">
                        {member.role} ·{" "}
                        {member.kind === "original"
                          ? member.signedOriginal
                            ? "Signed original PDF"
                            : "Original PDF"
                          : "Captured native draft"}{" "}
                        · Member revision: {member.revisionId}
                      </p>
                      {member.kind === "native" && (
                        <p className="break-all text-xs">
                          Source:{" "}
                          {source && !source.meta.deletedAt
                            ? source.meta.title
                            : member.source?.local
                              ? "unavailable; preserved copy retained"
                              : "foreign provenance; no local binding"}{" "}
                          · Captured{" "}
                          {new Date(
                            member.source?.capturedAt ?? 0,
                          ).toLocaleString()}
                        </p>
                      )}
                      {working && (
                        <p className="text-xs">
                          Working copy:{" "}
                          {docs[working.documentId]?.meta.title ||
                            "unavailable"}
                          . Changes remain outside the saved package until you
                          save a new revision.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {editable && (
                          <>
                            <label className="text-xs">
                              Role
                              <select
                                aria-label={`Role for ${member.label}`}
                                className="ml-1 rounded border bg-background p-1"
                                value={member.role}
                                onChange={(event) =>
                                  void run(() =>
                                    modify(
                                      revision.members.map((item) =>
                                        item.id === member.id
                                          ? {
                                              ...item,
                                              role: event.target
                                                .value as typeof member.role,
                                            }
                                          : item,
                                      ),
                                    ),
                                  )
                                }
                              >
                                {packageRoles.map((role) => (
                                  <option key={role}>{role}</option>
                                ))}
                              </select>
                            </label>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={index === 0}
                              onClick={() =>
                                void run(async () => {
                                  const members = [...revision.members];
                                  [members[index - 1], members[index]] = [
                                    members[index],
                                    members[index - 1],
                                  ];
                                  await modify(members);
                                })
                              }
                            >
                              Move up
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={index === revision.members.length - 1}
                              onClick={() =>
                                void run(async () => {
                                  const members = [...revision.members];
                                  [members[index + 1], members[index]] = [
                                    members[index],
                                    members[index + 1],
                                  ];
                                  await modify(members);
                                })
                              }
                            >
                              Move down
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void run(() =>
                                  modify(
                                    revision.members.filter(
                                      (item) => item.id !== member.id,
                                    ),
                                  ),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </>
                        )}
                        {member.kind === "native" && editable && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void run(async () => {
                                  update(
                                    await editPackageMember(
                                      record,
                                      member,
                                      operation.current?.signal,
                                    ),
                                  );
                                  onClose();
                                })
                              }
                            >
                              Edit working copy
                            </Button>
                            {working && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    useDocumentsStore
                                      .getState()
                                      .switchTo(working.documentId);
                                    onClose();
                                  }}
                                >
                                  Open working copy
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={working.documentId !== currentId}
                                  onClick={() =>
                                    void run(async () =>
                                      update(
                                        await savePackageWorkingCopy(
                                          record,
                                          member,
                                        ),
                                      ),
                                    )
                                  }
                                >
                                  Save working copy as new revision
                                </Button>
                              </>
                            )}
                            {source && !source.meta.deletedAt && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setComparison({
                                    member,
                                    source: structuredClone(source.session),
                                  })
                                }
                              >
                                Compare newer source
                              </Button>
                            )}
                          </>
                        )}
                        {member.kind === "original" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(() => reviewOriginal(member))
                            }
                          >
                            Download unchanged original
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {comparison && comparedSource && (
                <section className="space-y-3 rounded border p-3">
                  <h3 className="font-medium">
                    Compare captured member with library source
                  </h3>
                  <SessionChanges
                    before={comparison.member.session}
                    after={comparedSource}
                    highlightText
                  />
                  <p className="text-xs">
                    Adopting captures the selected source and its current files
                    as a new revision. Older members and outputs remain
                    preserved.
                  </p>
                  <Button
                    onClick={() =>
                      void run(async () =>
                        update(
                          await adoptPackageSource(
                            record,
                            comparison.member,
                            comparison.source,
                            operation.current?.signal,
                          ),
                        ),
                      )
                    }
                  >
                    Adopt source as new revision
                  </Button>
                  <Button variant="ghost" onClick={() => setComparison(null)}>
                    Cancel comparison
                  </Button>
                </section>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void run(() => review("assemble"))}>
                  Check readiness and assemble
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void run(() => review("portable"))}
                >
                  Export editable package
                </Button>
                {revision.outputs.length > 0 && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => void run(() => review("saved"))}
                    >
                      Download retained PDF
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void run(() => review("preview"))}
                    >
                      Preview retained PDF
                    </Button>
                  </>
                )}
              </div>
              {prepared && (
                <section className="space-y-3 rounded border p-3">
                  <h3 className="font-medium">
                    Package readiness: {prepared.readiness.state}
                  </h3>
                  {[prepared, ...otherReviews].flatMap((result, group) =>
                    result.readiness.findings.map((finding, index) => (
                      <p
                        key={`${group}-${index}`}
                        className="break-words text-sm"
                      >
                        {finding.severity === "error"
                          ? "Required: "
                          : "Review: "}
                        {revision.members.find(
                          (member) => member.id === finding.memberId,
                        )?.label
                          ? `${revision.members.find((member) => member.id === finding.memberId)!.label}: `
                          : ""}
                        {finding.message}
                      </p>
                    )),
                  )}
                  {[prepared, ...otherReviews].flatMap((result, group) =>
                    result.reviews.map((entry, index) => (
                      <div key={`${group}-${index}`} className="text-sm">
                        <p className="font-medium">{entry.member}</p>
                        {entry.review.privacy.findings.map((match, i) => (
                          <p key={i}>
                            {match.type}: {match.value}
                          </p>
                        ))}
                        {entry.review.structure.map((finding, i) => (
                          <p key={i}>{finding.message}</p>
                        ))}
                        {entry.review.notices.map((notice, i) => (
                          <p key={i}>{notice}</p>
                        ))}
                        {entry.review.markingReview && (
                          <p>Review classification markings.</p>
                        )}
                      </div>
                    )),
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(event) => setApproved(event.target.checked)}
                    />
                    I reviewed every included member, privacy findings,
                    markings, citations and original PDFs for this operation.
                    The assembled derivative is unsigned.
                  </label>
                  <Button
                    disabled={
                      !approved ||
                      [prepared, ...otherReviews].some((result) =>
                        ["draft", "incomplete"].includes(
                          result.readiness.state,
                        ),
                      )
                    }
                    onClick={() => void run(deliver)}
                  >
                    {reviewMode === "assemble"
                      ? "Assemble and retain PDF"
                      : reviewMode === "portable"
                        ? "Download reviewed editable package"
                        : reviewMode === "preview"
                          ? "Preview reviewed retained PDF"
                          : reviewMode === "original"
                            ? "Download reviewed unchanged original"
                            : "Download reviewed retained PDF"}
                  </Button>
                </section>
              )}
              {revision.outputs.map((output) => (
                <div key={output.id} className="break-all space-y-1 text-xs">
                  <p>
                    Retained output {output.id} · SHA-256 {output.asset.sha256}
                  </p>
                  <p>
                    {output.renderer} · unsigned assembled derivative. Retrieval
                    preserves exact bytes; future re-rendering depends on
                    available renderer resources and can produce different
                    bytes.
                  </p>
                  {output.boundaries.map((boundary) => (
                    <p key={boundary.memberId}>
                      {
                        revision.members.find(
                          (member) => member.id === boundary.memberId,
                        )?.label
                      }
                      : PDF pages {boundary.startPage}–
                      {boundary.startPage + boundary.pageCount - 1};{" "}
                      {boundary.numbering}, first label{" "}
                      {boundary.firstPageLabel}.
                    </p>
                  ))}
                </div>
              ))}
              {pdfUrl && (
                <iframe
                  title="Retained package PDF"
                  src={pdfUrl}
                  className="h-[60vh] w-full rounded border"
                />
              )}
            </>
          )}
        </fieldset>
        {busy && (
          <Button variant="outline" onClick={() => operation.current?.abort()}>
            Cancel operation
          </Button>
        )}
        {busy && (
          <p role="status">Saving or checking preserved package content…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
