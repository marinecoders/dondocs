import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PackageRenderComparisonView } from "@/components/PackageRenderComparisonView";
import type { PackageRenderComparison } from "@/lib/packageRenderComparison";

it("keeps limited observations and unavailable legacy/image evidence clear without a parity badge", () => {
  const comparison: PackageRenderComparison = {
    revisionId: "revision", beforeId: "before", afterId: "after", beforeCreatedAt: 1, afterCreatedAt: 2,
    beforeVersion: null, afterVersion: "1.3.100", beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64),
    identicalBytes: false, extractedText: "matches", textLayout: "matches", pageGeometry: "matches", memberBoundaries: "matches",
    recordedInputs: "unavailable", recordedResources: "unavailable", beforePages: 2, afterPages: 2, pagesWithoutText: [2],
  };
  render(<PackageRenderComparisonView comparison={comparison} />);
  expect(screen.getByRole("region", { name: "Retained PDF comparison" })).toBeTruthy();
  expect(screen.getByText(/do not establish visual equivalence/)).toBeTruthy();
  expect(screen.getByText(/Pages without a readable text layer.*2/)).toBeTruthy();
  expect(screen.getByText("Unavailable for a legacy output")).toBeTruthy();
  expect(screen.queryByText(/passed|compatible|equivalent$/i)).toBeNull();
});
