import type { PreparedPackageShare } from "@/lib/actionPackageShare";
import { getPIITypeLabel } from "@/services/pii/detector";

export function PackageShareReview({ prepared }: { prepared: PreparedPackageShare }) {
  return <section aria-label="Package content review" className="space-y-3 rounded border p-3 text-sm">
    <p className="font-medium break-words">{prepared.name}</p>
    <p>Selected revision: <span className="break-all font-mono">{prepared.revisionId}</span></p>
    <ul className="list-disc space-y-1 pl-5">
      {prepared.members.map((member, index) => <li key={index} className="break-words">
        {member.label} · {member.role} · {member.kind === "native" ? "editable captured document" : "unchanged original"}
      </li>)}
    </ul>
    <p>Includes this revision’s required templates, original files and retained PDFs. Other revisions and local working copies are excluded.</p>
    {prepared.expiresAt !== undefined && <p>Expires {new Date(prepared.expiresAt).toLocaleString(undefined, { timeZoneName: "short" })}.</p>}
    {prepared.reviews.map(({ member, review }, index) => <div key={index} className="space-y-1 break-words">
      {(review.privacy.findings.length > 0 || review.notices.length > 0 || review.structure.length > 0 || review.markingReview) && <p className="font-medium">{member}</p>}
      {review.privacy.findings.map((finding, i) => <p key={`privacy-${i}`}>{getPIITypeLabel(finding.type)}: {finding.value}</p>)}
      {review.structure.map((finding, i) => <p key={`structure-${i}`}>{finding.message}</p>)}
      {review.notices.map((notice, i) => <p key={`notice-${i}`}>{notice}</p>)}
      {review.markingReview && <p>Review classification markings.</p>}
    </div>)}
    <p className="text-muted-foreground">Inspect original PDFs and images manually. Automatic text checks cannot read scanned images.</p>
  </section>;
}
