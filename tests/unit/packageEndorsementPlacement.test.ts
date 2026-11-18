import { expect, it } from 'vitest';
import { packageInkBounds, canMeasurePackageEndorsement } from '@/lib/packageEndorsementPlacement';
import { createBlankSession } from '@/stores/documentStore';
import type { NativePackageMember } from '@/lib/actionPackages';
function member(endorsement = false): NativePackageMember {
  const session = createBlankSession(); session.docType = endorsement ? 'new_page_endorsement' : 'naval_letter'; session.formData.sigLast = 'EXAMPLE';
  return { id: 'member', revisionId: 'one', label: 'Synthetic', kind: 'native', role: endorsement ? 'endorsement' : 'basic-letter', required: true, session,
    draft: { id: 'draft', name: 'draft.json', type: 'application/json', size: 1, sha256: 'a'.repeat(64) } };
}
it('restricts measured placement to unsigned native correspondence without appended files', () => {
  const before = member(), next = member(true);
  expect(canMeasurePackageEndorsement(before, next)).toBe(true);
  next.session.formData.signatureType = 'digital'; expect(canMeasurePackageEndorsement(before, next)).toBe(false);
  next.session.formData.signatureType = 'none'; next.session.formData.classLevel = 'cui'; expect(canMeasurePackageEndorsement(before, next)).toBe(false);
});
it('measures every visible content pixel while excluding the reserved footer', () => {
  const pixels = new Uint8ClampedArray(612 * 792 * 4); pixels.fill(255);
  function ink(x: number, y: number) { const offset = (y * 612 + x) * 4; pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0; }
  ink(54, 100); ink(300, 450); ink(300, 770);
  expect(packageInkBounds(pixels, 612, 792)).toEqual({ top: 694, bottom: 340 });
  expect(packageInkBounds(pixels, 792, 612)).toBeUndefined();
});

it('uses a new page for custom layouts and unqualified body graphics', () => {
  const before = member(), next = member(true); next.session.documentMode = 'custom';
  expect(canMeasurePackageEndorsement(before, next)).toBe(false);
  next.session.documentMode = 'compliant'; next.session.paragraphs = [{ id: 'figure', text: '', level: 0, figure: { name: 'Synthetic image', type: 'image/png', width: 10, height: 10 } }];
  expect(canMeasurePackageEndorsement(before, next)).toBe(false);
});
