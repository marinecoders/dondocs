import { useEffect, useRef, useState } from "react";
import { sameReviewStoredValue } from "@/lib/documentsDb";
import { Button } from "@/components/ui/button";
import { PackageCitationRepair } from "./PackageCitationRepair";
import type { ActionPackage, PackageRevision } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences, resolvePackageCitations, type PackageCitationOccurrence, type ResolvedPackageCitationTarget, type ResolvedPackageCitationLink } from "@/lib/packageCitations";
import { focusPackageDestination, matchesPackageDestination, type PackageDestinationRequest } from "@/lib/packageDestinations";

interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  editable: boolean;
  onChange(action: (signal?: AbortSignal) => Promise<ActionPackage>): void;
  destination?: PackageDestinationRequest;
}
interface CitationCapture {
  owner: string;
  occurrences: PackageCitationOccurrence[];
  targets: ResolvedPackageCitationTarget[];
  links: ResolvedPackageCitationLink[];
  error?: string;
}

/** Linking is deliberate; an index or matching title never establishes identity. */
export function PackageCitations({ record, revision, editable, onChange, destination }: Props) {
  const owner = `${record.id}:${revision.id}`, content = useRef<HTMLElement>(null), handledDestination = useRef("");
  const [capture, setCapture] = useState<CitationCapture>();
  const [selection, setSelection] = useState({ owner, sourceIndex: "", targetId: "" });
  const activeCapture = capture?.owner === owner ? capture : undefined, loading = !activeCapture;
  const occurrences = activeCapture?.occurrences ?? [], targets = activeCapture?.targets ?? [], links = activeCapture?.links ?? [];
  const error = activeCapture?.error;
  const sourceIndex = selection.owner === owner ? selection.sourceIndex : "", targetId = selection.owner === owner ? selection.targetId : "";
  const canEdit = editable && !record.archived && revision.id === record.currentRevisionId
    && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  useEffect(() => {
    let current = true;
    void Promise.all([packageCitationOccurrences(revision), resolvePackageCitations(revision)]).then(([occurrences, resolved]) => {
      if (!current) return;
      setCapture({ owner, occurrences: occurrences.filter(occurrence => !resolved.links.some(link => sameReviewStoredValue(link.link.source, occurrence.source))), targets: resolved.targets, links: resolved.links });
    }).catch(cause => { if (current) setCapture({ owner, occurrences: [], targets: [], links: [], error: cause instanceof Error ? cause.message : "Citation identities could not be read." }); });
    return () => { current = false; };
  }, [owner, revision]);
  useEffect(() => {
    if (!matchesPackageDestination(destination, record.id, revision.id) || !destination.citationId || !activeCapture || activeCapture.error) return;
    const request = `${owner}:${destination.requestId}`;
    if (handledDestination.current === request) return;
    handledDestination.current = request;
    // Valid metadata uses one identity namespace for targets and occurrences. Never guess if a malformed capture is ambiguous.
    const matches = [...activeCapture.targets.filter(value => value.target.id === destination.citationId).map(value => value.target.memberId),
      ...activeCapture.links.filter(value => value.link.id === destination.citationId).map(value => value.link.source.memberId)];
    if (matches.length !== 1 || (destination.memberId && destination.memberId !== matches[0])) return;
    focusPackageDestination(content.current, "data-package-citation-id", destination.citationId);
  }, [destination, record.id, revision.id, owner, activeCapture]);
  const source = sourceIndex === "" ? undefined : occurrences[Number(sourceIndex)];
  const compatible = targets.filter(value => value.state === "current" && (value.target.kind === "package-enclosure" || value.target.memberId === source?.source.memberId) && (value.target.kind === "reference") === (source?.source.kind === "reference"));
  return <section ref={content} aria-label="Package citation identities" className="min-w-0 space-y-3 rounded border p-3 text-sm">
    <h3 className="font-medium">Linked references and enclosures</h3>
    <p>Identify this revision’s references and enclosures, then explicitly link supported body citations to their targets. Saving creates a new package revision and preserves the captured files.</p>
    <p>Linking alone leaves text unchanged. Supported reorder operations show a review before updating linked citation labels. Changed or missing bindings stay visible for repair.</p>
    {loading && <p role="status">Reading citation identities…</p>}
    {error && <p role="alert">{error}</p>}
    <p>{targets.length} identified targets · {links.length} linked citations</p>
    {targets.length > 0 && <ul className="list-disc space-y-1 pl-5" aria-label="Identified citation targets">{targets.map(value => <li key={value.target.id} tabIndex={-1} data-package-citation-id={value.target.id} className="break-words">{value.label} · {value.state}</li>)}</ul>}
    {links.length > 0 && <ul className="list-disc space-y-1 pl-5" aria-label="Linked citation occurrences">{links.map(value => <li key={value.link.id} tabIndex={-1} data-package-citation-id={value.link.id} className="break-words">{value.label} → {value.target.label} · {value.state}</li>)}</ul>}
    {canEdit && <fieldset disabled={loading || !!error} className="min-w-0 space-y-3">
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" onClick={() => onChange(signal => initializePackageCitationTargets(record, signal))}>Identify current references and enclosures</Button>
      <label className="block">Citation occurrence
        <select aria-label="Citation occurrence" className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={sourceIndex} onChange={event => setSelection({ owner, sourceIndex: event.target.value, targetId: "" })}>
          <option value="">Select a supported occurrence</option>
          {occurrences.map((value, index) => <option key={index} value={index}>{value.label}</option>)}
        </select>
      </label>
      <label className="block">Citation target
        <select aria-label="Citation target" className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={targetId} onChange={event => setSelection({ owner, sourceIndex, targetId: event.target.value })}>
          <option value="">Select the intended target</option>
          {compatible.map(value => <option key={value.target.id} value={value.target.id}>{value.label}</option>)}
        </select>
      </label>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={!source || !compatible.some(value => value.target.id === targetId)} onClick={() => { if (source) onChange(signal => linkPackageCitation(record, source.source, targetId, signal)); }}>Save citation link</Button>
      {!loading && occurrences.length === 0 && <p>No unlinked supported occurrences. Use explicit “reference (a)” or “enclosure (1)” text in a native correspondence paragraph with a stable paragraph identity.</p>}
    </fieldset>}
    <PackageCitationRepair key={`citation-repair:${owner}`} record={record} revision={revision} editable={canEdit} onChange={onChange} />
  </section>;
}
