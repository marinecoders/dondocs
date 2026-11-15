import { useEffect, useState } from "react";
import { sameReviewStoredValue } from "@/lib/documentsDb";
import { Button } from "@/components/ui/button";
import type { ActionPackage, PackageRevision } from "@/lib/actionPackages";
import { initializePackageCitationTargets, linkPackageCitation, packageCitationOccurrences, resolvePackageCitations, type PackageCitationOccurrence, type ResolvedPackageCitationTarget, type ResolvedPackageCitationLink } from "@/lib/packageCitations";

interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  editable: boolean;
  onChange(action: (signal?: AbortSignal) => Promise<ActionPackage>): void;
}

/** Linking is deliberate; an index or matching title never establishes identity. */
export function PackageCitations({ record, revision, editable, onChange }: Props) {
  const [occurrences, setOccurrences] = useState<PackageCitationOccurrence[]>([]);
  const [targets, setTargets] = useState<ResolvedPackageCitationTarget[]>([]);
  const [links, setLinks] = useState<ResolvedPackageCitationLink[]>([]);
  const [sourceIndex, setSourceIndex] = useState("");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void Promise.all([packageCitationOccurrences(revision), resolvePackageCitations(revision)]).then(([occurrences, resolved]) => {
      if (!current) return;
      setOccurrences(occurrences.filter(occurrence => !resolved.links.some(link => sameReviewStoredValue(link.link.source, occurrence.source))));
      setTargets(resolved.targets); setLinks(resolved.links); setLoading(false);
    }).catch(cause => { if (current) { setError(cause instanceof Error ? cause.message : "Citation identities could not be read."); setLoading(false); } });
    return () => { current = false; };
  }, [revision]);
  const source = sourceIndex === "" ? undefined : occurrences[Number(sourceIndex)];
  const compatible = targets.filter(value => value.state === "current" && (value.target.kind === "package-enclosure" || value.target.memberId === source?.source.memberId) && (value.target.kind === "reference") === (source?.source.kind === "reference"));
  return <section aria-label="Package citation identities" className="space-y-3 rounded border p-3 text-sm">
    <h3 className="font-medium">Linked references and enclosures</h3>
    <p>Identify this revision’s references and enclosures, then explicitly link supported body citations to their targets. Saving creates a new package revision and preserves the captured files.</p>
    <p>Linking alone leaves text unchanged. Supported reorder operations show a review before updating linked citation labels. Changed or missing bindings stay visible for repair.</p>
    {loading && <p role="status">Reading citation identities…</p>}
    {error && <p role="alert">{error}</p>}
    <p>{targets.length} identified targets · {links.length} linked citations</p>
    {targets.length > 0 && <ul className="list-disc space-y-1 pl-5" aria-label="Identified citation targets">{targets.map(value => <li key={value.target.id} className="break-words">{value.label} · {value.state}</li>)}</ul>}
    {links.length > 0 && <ul className="list-disc space-y-1 pl-5" aria-label="Linked citation occurrences">{links.map(value => <li key={value.link.id} className="break-words">{value.label} → {value.target.label} · {value.state}</li>)}</ul>}
    {editable && <fieldset disabled={loading || !!error} className="space-y-3">
      <Button variant="outline" onClick={() => onChange(signal => initializePackageCitationTargets(record, signal))}>Identify current references and enclosures</Button>
      <label className="block">Citation occurrence
        <select aria-label="Citation occurrence" className="mt-1 w-full rounded border bg-background p-2" value={sourceIndex} onChange={event => { setSourceIndex(event.target.value); setTargetId(""); }}>
          <option value="">Select a supported occurrence</option>
          {occurrences.map((value, index) => <option key={index} value={index}>{value.label}</option>)}
        </select>
      </label>
      <label className="block">Citation target
        <select aria-label="Citation target" className="mt-1 w-full rounded border bg-background p-2" value={targetId} onChange={event => setTargetId(event.target.value)}>
          <option value="">Select the intended target</option>
          {compatible.map(value => <option key={value.target.id} value={value.target.id}>{value.label}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={!source || !compatible.some(value => value.target.id === targetId)} onClick={() => { if (source) onChange(signal => linkPackageCitation(record, source.source, targetId, signal)); }}>Save citation link</Button>
      {!loading && occurrences.length === 0 && <p>No unlinked supported occurrences. Use explicit “reference (a)” or “enclosure (1)” text in a native correspondence paragraph with a stable paragraph identity.</p>}
    </fieldset>}
  </section>;
}
