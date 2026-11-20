import { expect, it } from 'vitest';
import { requiresCurrentDocumentReader } from '@/lib/documentReaderRequirements';
import { createBlankSession } from '@/stores/documentStore';
import { parseSharedSession } from '@/lib/sharedSession';
import { parseSavedSession } from '@/lib/savedSession';

it('requires the current reader for active and retained volume structure', () => {
  expect(requiresCurrentDocumentReader({ docType: 'technical_volume' })).toBe(true);
  expect(requiresCurrentDocumentReader({ docType: 'naval_letter', formData: { volume: {} } })).toBe(true);
  expect(requiresCurrentDocumentReader({ paragraphs: [{ text: 'Retained', volumeSectionId: 'chapter-1' }] })).toBe(true);
  expect(requiresCurrentDocumentReader({ paragraphs: [{ text: 'Ordinary prose' }] })).toBe(false);
});

it.each(['columnWidths', 'columnAlignments', 'borders', 'fontSize', 'minimumRowHeight', 'repeatHeaders'])('protects retained formatted table %s', key => {
  expect(requiresCurrentDocumentReader({ paragraphs: [{ bodyTable: { [key]: false } }] })).toBe(true);
  expect(requiresCurrentDocumentReader({ paragraphs: [{ bodyTable: { [key]: undefined } }] })).toBe(false);
});

it('requires the current reader for enclosure declarations and transmittal confirmations', () => {
  expect(requiresCurrentDocumentReader({ enclosures: [{ marking: { classLevel: 'unclassified' } }] })).toBe(true);
  expect(requiresCurrentDocumentReader({ formData: { cuiTransmittalNote: true } })).toBe(true);
  expect(requiresCurrentDocumentReader({ formData: { cuiTransmittalNote: false } })).toBe(false);
});

it('rejects malformed transmittal flags in shared and saved drafts', () => {
  const session = createBlankSession();
  session.formData.cuiTransmittalNote = 'yes' as never;
  expect(() => parseSharedSession(session)).toThrow();
  expect(() => parseSavedSession(session)).toThrow();
});
