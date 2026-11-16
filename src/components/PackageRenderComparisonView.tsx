import type { ComparisonFinding, PackageRenderComparison } from "@/lib/packageRenderComparison";

const label = (value: ComparisonFinding) => value === "matches" ? "Match" : value === "differs" ? "Different" : "Unavailable";
const when = (value: number) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : "Unknown date";

export function PackageRenderComparisonView({ comparison }: { comparison: PackageRenderComparison }) {
  const checks: Array<[string, string]> = [
    ["PDF file bytes", comparison.identicalBytes ? "Identical" : "Different"],
    ["Extracted text", label(comparison.extractedText)],
    ["Text layout", label(comparison.textLayout)],
    ["Page geometry", label(comparison.pageGeometry)],
    ["Member boundaries and numbering", label(comparison.memberBoundaries)],
    ["Recorded input fingerprints", comparison.recordedInputs === "matches" ? "Match" : "Unavailable for a legacy output"],
    ["Recorded renderer resources", label(comparison.recordedResources)],
  ];
  return (
    <section aria-label="Retained PDF comparison" className="space-y-3 rounded border p-3 text-sm">
      <h3 className="font-medium">Retained PDF comparison</h3>
      <p>Earlier PDF: {when(comparison.beforeCreatedAt)} · {comparison.beforePages} pages · build {comparison.beforeVersion ?? "not recorded"}.</p>
      <p>Later PDF: {when(comparison.afterCreatedAt)} · {comparison.afterPages} pages · build {comparison.afterVersion ?? "not recorded"}.</p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
        {checks.map(([name, result]) => <div className="contents" key={name}><dt>{name}</dt><dd>{result}</dd></div>)}
      </dl>
      <p>These checks compare saved bytes, the extracted text layer, visible page boxes and member boundaries. They do not establish visual equivalence of images, drawings or font appearance. Review the PDF pages before relying on a new rendering.</p>
      {comparison.pagesWithoutText.length > 0 && <p>Pages without a readable text layer in either output: {comparison.pagesWithoutText.join(", ")}. Their image or scanned content needs visual review.</p>}
      <p>Build and resource information describes what was recorded; it does not authenticate the sender. Both saved PDFs and their original files remain unchanged.</p>
    </section>
  );
}
