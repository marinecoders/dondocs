import { describe, it, expect } from 'vitest';
import {
  DOC_TYPE_CONFIG,
  DOC_TYPE_CATEGORIES,
  DOC_TYPE_LABELS,
  DOC_TYPE_CHIP,
} from '@/types/document';

// Registering a document type takes four edits: a config, a label, a chip, and
// membership in a selector category. Miss the category and the type is fully
// built, compiles in the matrix, and is simply unreachable in the UI -- which
// is exactly how i_type first shipped. These assert the four stay in step.
describe('document type registration', () => {
  const configured = Object.keys(DOC_TYPE_CONFIG);
  const categorized = DOC_TYPE_CATEGORIES.flatMap((c) => c.types);

  it('offers every configured type in the selector', () => {
    expect([...configured].sort()).toEqual([...categorized].sort());
  });

  it('lists no type twice', () => {
    expect(new Set(categorized).size).toBe(categorized.length);
  });

  it('gives every configured type a label and a chip', () => {
    for (const type of configured) {
      expect(DOC_TYPE_LABELS[type], `${type} has no label`).toBeTruthy();
      expect(DOC_TYPE_CHIP[type], `${type} has no chip`).toBeTruthy();
    }
  });

  it('delivers the I-Type as PDF, with enclosure labels in the footer', () => {
    expect(DOC_TYPE_CONFIG.i_type.pdfOnly).toBe(true);
    expect(DOC_TYPE_CONFIG.i_type.enclosureLabel).toBe('footer');
    expect(DOC_TYPE_CONFIG.i_type.regulations.authority).toBe('MIL-STD-38784C');
  });
});
