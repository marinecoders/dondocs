import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionPackage, PackageRevision } from "@/lib/actionPackages";
import { getExportDeploymentPolicy } from "@/config/classification";
import { packageCitationCandidates, packageCitationOccurrences, resolvePackageCitations, type PackageCitationCandidate, type PackageCitationOccurrence, type ResolvedPackageCitationLink, type ResolvedPackageCitationTarget } from "@/lib/packageCitations";
import { applyPackageCitationRepair, packageCitationSourceLocation, preparePackageCitationRepair, type PackageCitationRepairAction, type PreparedPackageCitationRepair } from "@/lib/packageCitationRepair";

interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  editable: boolean;
  onChange(action: (signal?: AbortSignal) => Promise<ActionPackage>): void;
}

export function PackageCitationRepair({ record, revision, editable, onChange }: Props) {
  const [links, setLinks] = useState<ResolvedPackageCitationLink[]>([]), [targets, setTargets] = useState<ResolvedPackageCitationTarget[]>([]);
  const [occurrences, setOccurrences] = useState<PackageCitationOccurrence[]>([]), [candidates, setCandidates] = useState<PackageCitationCandidate[]>([]);
  const [linkId, setLinkId] = useState(""), [sourceIndex, setSourceIndex] = useState(""), [targetIndex, setTargetIndex] = useState("");
  const [prepared, setPrepared] = useState<PreparedPackageCitationRepair | null>(null), [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const live = useRef(true), operation = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    void Promise.all([resolvePackageCitations(revision), packageCitationOccurrences(revision), packageCitationCandidates(revision)])
      .then(([resolved, occurrences, candidates]) => {
        if (!live.current) return;
        setLinks(resolved.links); setTargets(resolved.targets); setOccurrences(occurrences); setCandidates(candidates); setBusy(false);
      }).catch(cause => { if (live.current) { setError(cause instanceof Error ? cause.message : "Citation repair could not be opened."); setBusy(false); } });
    return () => { live.current = false; operation.current?.abort(); };
  }, [revision]);
  const source = sourceIndex === "" ? undefined : occurrences[Number(sourceIndex)];
  const target = targetIndex === "" ? undefined : candidates[Number(targetIndex)];
  const selectedLink = links.find(value => value.link.id === linkId);
  function invalidate() { operation.current?.abort(); setPrepared(null); setApproved(false); setError(""); }
  async function review(action: PackageCitationRepairAction) {
    if (busy) return;
    invalidate(); const controller = new AbortController(); operation.current = controller; setBusy(true);
    try {
      const result = await preparePackageCitationRepair(record, action, await getExportDeploymentPolicy(), controller.signal);
      if (live.current && !controller.signal.aborted) setPrepared(result);
    } catch (cause) { if (live.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The repair could not be prepared."); }
    finally { if (live.current) setBusy(false); }
  }
  const broken = links.filter(value => value.state !== "current");
  if (!revision.citations) return null;
  return <section aria-label="Package citation repair" className="space-y-3 rounded border p-3 text-sm">
    <h3 className="font-medium">Citation repair</h3>
    <p>{broken.length} linked citations need repair. Broken tracked links prevent assembly. Unlinked literal text still needs manual review.</p>
    {broken.length > 0 && <ul aria-label="Citations needing repair" className="list-disc space-y-1 pl-5">{broken.map(value => <li key={value.link.id}>{packageCitationSourceLocation(revision, value.link.source)} · {value.label} → {value.target.label}: {value.sourceState !== "current" ? "source text changed or missing" : value.target.state !== "current" ? "target changed or missing" : "label does not match target"}</li>)}</ul>}
    {busy && <p role="status">Reading or saving citation repair…</p>}
    {error && <p role="alert">{error}</p>}
    {editable && <fieldset disabled={busy || !!error && links.length === 0} className="space-y-3">
      <label className="block">Link to repair
        <select aria-label="Link to repair" className="mt-1 w-full rounded border bg-background p-2" value={linkId} onChange={event => { invalidate(); setLinkId(event.target.value); setSourceIndex(""); setTargetIndex(""); }}>
          <option value="">Choose a linked citation</option>
          {links.map(value => <option key={value.link.id} value={value.link.id}>{packageCitationSourceLocation(revision, value.link.source)} · {value.label} → {value.target.label} · {value.state}</option>)}
        </select>
      </label>
      <label className="block">Current citation occurrence
        <select aria-label="Current citation occurrence" className="mt-1 w-full rounded border bg-background p-2" value={sourceIndex} onChange={event => { invalidate(); setSourceIndex(event.target.value); setTargetIndex(""); }}>
          <option value="">Choose the exact current text</option>
          {occurrences.map((value, index) => value.source.kind === selectedLink?.link.source.kind ? <option key={index} value={index}>{value.label}</option> : null)}
        </select>
      </label>
      <label className="block">Replacement citation target
        <select aria-label="Replacement citation target" className="mt-1 w-full rounded border bg-background p-2" value={targetIndex} onChange={event => { invalidate(); setTargetIndex(event.target.value); }}>
          <option value="">Choose the intended current target</option>
          {candidates.map((value, index) => (value.target.kind === "reference") === (source?.source.kind === "reference") && (value.target.kind === "package-enclosure" || value.target.memberId === source?.source.memberId)
            ? <option key={index} value={index}>{value.label}</option> : null)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!linkId || !source || !target} onClick={() => { if (source && target) void review({ kind: "relink", linkId, source: source.source, target: target.target }); }}>Review citation repair</Button>
        <Button variant="outline" disabled={!linkId} onClick={() => void review({ kind: "discard-link", linkId })}>Review discarding link</Button>
      </div>
      <p>Discarding a link leaves its document text unchanged and unverified. Remove or correct the literal text separately when needed.</p>
      {targets.some(value => !links.some(link => link.link.targetId === value.target.id)) && <details>
        <summary>Remove unused identities</summary>
        <ul className="space-y-2">{targets.filter(value => !links.some(link => link.link.targetId === value.target.id)).map(value => <li key={value.target.id} className="space-y-1"><p>{value.label}</p><Button variant="outline" onClick={() => void review({ kind: "remove-target", targetId: value.target.id })}>Review removing {value.label}</Button></li>)}</ul>
      </details>}
      {prepared && <section aria-label="Citation repair preview" className="space-y-2 rounded border p-3">
        <p>{prepared.explanation}</p>
        <p className="break-words">Before: {prepared.before}</p><p className="break-words">After: {prepared.after}</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />{prepared.discardsLink ? "I understand the text remains literal and requires manual review." : "I reviewed the occurrence, target and displayed changes for this new revision."}</label>
        <Button disabled={!approved} onClick={() => {
          if (!approved) return;
          setBusy(true);
          onChange(async signal => { try { return await applyPackageCitationRepair(prepared, signal, () => live.current); } finally { if (live.current) setBusy(false); } });
        }}>Save reviewed citation repair</Button>
        <Button variant="outline" onClick={invalidate}>Cancel repair</Button>
      </section>}
    </fieldset>}
  </section>;
}
