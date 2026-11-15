import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionPackage, PackageRevision } from "@/lib/actionPackages";
import { applyPackageCitationReorder, type PackageCitationReorder as ReorderOperation, type PreparedPackageCitationReorder } from "@/lib/packageCitationReorder";
import { canTrackReferenceCitations } from "@/lib/referenceCitations";
import { getPIITypeLabel } from "@/services/pii/detector";

interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  editable: boolean;
  prepared: PreparedPackageCitationReorder | null;
  onPrepare(operation: ReorderOperation): void;
  onDiscard(): void;
  onChange(action: (signal?: AbortSignal) => Promise<ActionPackage>): void;
}

export function PackageCitationReorder({ record, revision, editable, prepared, onPrepare, onDiscard, onChange }: Props) {
  const natives = revision.members.filter(member => member.kind === "native" && canTrackReferenceCitations(member.session));
  const [memberId, setMemberId] = useState(natives[0]?.id ?? ""), [kind, setKind] = useState<"references" | "enclosures">("references");
  const [draftOrder, setDraftOrder] = useState<number[] | null>(null), [approved, setApproved] = useState<PreparedPackageCitationReorder | null>(null);
  const member = natives.find(member => member.id === memberId);
  const items = member?.kind === "native" ? member.session[kind] : [];
  const order = draftOrder ?? items.map((_, index) => index);
  const reviewed = prepared?.packageId === record.id && prepared.sequence === record.sequence && prepared.revisionId === revision.id ? prepared : null;
  function reset() { setDraftOrder(null); setApproved(null); onDiscard(); }
  return <section aria-label="Linked citation reordering" className="space-y-3 rounded border p-3 text-sm">
    <h3 className="font-medium">Reorder linked references and enclosures</h3>
    <p>Review the new order and every affected linked citation before saving a new revision. Earlier revisions and original signed files are preserved. Unlinked or unsupported affected citations require manual correction.</p>
    {editable && natives.length > 0 && <fieldset className="space-y-3">
      <label className="block">Native member to reorder
        <select aria-label="Native member to reorder" className="mt-1 w-full rounded border bg-background p-2" value={memberId} onChange={event => { setMemberId(event.target.value); reset(); }}>
          {natives.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
        </select>
      </label>
      <label className="block">Native list to reorder
        <select aria-label="Native list to reorder" className="mt-1 w-full rounded border bg-background p-2" value={kind} onChange={event => { setKind(event.target.value as typeof kind); reset(); }}>
          <option value="references">References</option><option value="enclosures">Enclosures</option>
        </select>
      </label>
      <ol aria-label="Proposed native list order" className="list-decimal space-y-2 pl-5">
        {order.map((index, position) => <li key={index} className="break-words">
          {items[index]?.title}
          <div className="flex flex-wrap gap-2">
            {([-1, 1] as const).map(direction => <Button key={direction} size="sm" variant="outline" disabled={position + direction < 0 || position + direction >= order.length}
              aria-label={`Move list item ${position + 1} ${direction < 0 ? "up" : "down"}`} onClick={() => {
                const next = [...order]; [next[position], next[position + direction]] = [next[position + direction], next[position]];
                setDraftOrder(next); setApproved(null); onDiscard();
              }}>Move {direction < 0 ? "up" : "down"}</Button>)}
          </div>
        </li>)}
      </ol>
      <Button variant="outline" disabled={!member || order.every((value, index) => value === index)} onClick={() => { setApproved(null); onPrepare({ kind, memberId, order }); }}>Review native list reorder</Button>
    </fieldset>}
    {reviewed && <section aria-label="Citation reorder review" className="space-y-3 rounded border p-3">
      <h4 className="font-medium">Review proposed {reviewed.kind === "members" ? "package member" : reviewed.kind === "references" ? "reference" : "enclosure"} order</h4>
      <ol className="list-decimal space-y-1 pl-5">{reviewed.orderLabels.map((label, index) => <li className="break-words" key={index}>{label}</li>)}</ol>
      {reviewed.changes.length === 0 && <p>No linked paragraph text changes are needed for this order.</p>}
      {reviewed.changes.map((change, index) => <div className="space-y-1" key={index}>
        <p className="font-medium">{change.label}</p><p className="whitespace-pre-wrap break-words">Before: {change.before}</p><p className="whitespace-pre-wrap break-words">After: {change.after}</p>
      </div>)}
      {reviewed.reviews.map((review, index) => <div key={index}>
        {review.privacy.findings.map((finding, index) => <p key={index}>{getPIITypeLabel(finding.type)}: {finding.value}</p>)}
        {review.notices.map((notice, index) => <p key={index}>{notice}</p>)}
        {review.markingReview && <p>Review the retained classification markings.</p>}
      </div>)}
      {editable && <>
        <label className="flex items-start gap-2"><input type="checkbox" checked={approved === reviewed} onChange={event => setApproved(event.target.checked ? reviewed : null)} />I reviewed the proposed order, citation changes, privacy findings and classification markings.</label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={approved !== reviewed} onClick={() => onChange(signal => applyPackageCitationReorder(reviewed, signal))}>Save reviewed citation reorder</Button>
          <Button variant="outline" onClick={() => { setApproved(null); onDiscard(); }}>Cancel citation reorder</Button>
        </div>
      </>}
    </section>}
  </section>;
}
