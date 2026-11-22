import { describe, expect, it } from 'vitest';
import { letterSchema } from '../companion/letterSchema';
import { toStore } from '../companion/letterInput';
import { formatsFor, validateLetter } from '../companion/validateLetter';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { resolveCapabilities } from '@/lib/documentCapabilities';
import { volumeFixture } from './_helpers/volumeFixture';

function request() {
  const source = volumeFixture();
  return letterSchema.parse({ docType: source.docType, subject: source.formData.subject, volume: source.formData.volume, paragraphs: source.paragraphs });
}
describe('volume companion contract', () => {
  it('accepts a complete structured request and retains native tables and identities through the real mapper', () => {
    const input = request();
    expect(validateLetter(input)).toEqual([]);
    const store = toStore(input);
    expect(store.formData.signatureType).toBe('none');
    expect(store.formData.volume).toEqual(input.volume);
    expect(store.paragraphs).toEqual(input.paragraphs);
    expect(generateAllLatexFiles(store).texFiles['body.tex']).toContain('\\dondocsReferenceAnchor{volume.node.limits}');
    expect(formatsFor(input.docType)).toEqual(['pdf', 'docx']);
    expect(resolveCapabilities({ kind: 'correspondence', documentMode: 'compliant', docType: input.docType }, { operation: 'export', target: 'docx' }).status).toBe('partial');
    expect(validateLetter({ ...input, format: 'docx' })).toEqual([]);
  });
  it('rejects orphan sections, incompatible metadata, and extra enclosure content', () => {
    const input = request();
    input.paragraphs![0].volumeSectionId = 'deleted';
    expect(validateLetter(input).join(' ')).toContain('not assigned');
    expect(validateLetter({ ...request(), docType: 'naval_letter' }).join(' ')).toContain('require docType technical_volume');
    expect(validateLetter({ ...request(), enclosures: [{ title: 'Unrendered' }] }).join(' ')).toContain('external package members');
  });
});
