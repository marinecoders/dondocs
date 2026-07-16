/**
 * The acknowledgement template is the first template with a docType other than
 * `naval_letter`, so it exercises a path the other 11 never have: the loader
 * must switch the document type, and the endorsement generator must render the
 * template's paragraphs. These tests pin both, plus the placeholder contract
 * (the duty title and references vary per appointment; the letter shape does
 * not, so nothing about a specific duty may be baked in).
 */
import { describe, it, expect } from 'vitest';
import { LETTER_TEMPLATES } from '@/data/templates';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { DOC_TYPE_CONFIG, DOC_TYPE_LABELS } from '@/types/document';

const ack = LETTER_TEMPLATES.find((t) => t.id === 'appointment-acknowledgement')!;

describe('appointment acknowledgement template', () => {
  it('is registered', () => {
    expect(ack).toBeDefined();
  });

  it('is an endorsement, not a naval letter — it is the appointee half', () => {
    expect(ack.docType).toBe('same_page_endorsement');
    // Guard the loader contract: TemplateLoaderModal calls setDocType(t.docType),
    // so an unknown docType would silently produce a broken document.
    expect(DOC_TYPE_CONFIG[ack.docType]).toBeDefined();
    expect(DOC_TYPE_LABELS[ack.docType]).toBeDefined();
  });

  it('carries the read-and-understand / assume-the-duties wording', () => {
    const text = ack.paragraphs.map((p) => p.text).join(' ');
    expect(text).toMatch(/read and understand/i);
    expect(text).toMatch(/assume the duties and responsibilities/i);
  });

  it('leaves duty and unit as placeholders — the refs change per appointment', () => {
    const text = ack.paragraphs.map((p) => p.text).join(' ');
    expect(text).toContain('[DUTY TITLE]');
    expect(text).toContain('[UNIT NAME]');
    // No specific program's orders may be baked in: the same letter serves MSG,
    // SMP, safety, or any other collateral duty, and each cites its own.
    expect(text).not.toMatch(/MCO\s+\d/);
    expect(text).not.toMatch(/\bSMP\b|Single Marine Program/i);
  });

  it('renders through the endorsement generator', () => {
    const tex = generateFlatLatex({
      docType: ack.docType,
      formData: {
        docType: ack.docType,
        from: 'Sergeant J. A. DOE, USMC',
        to: 'Commanding Officer, 1st Battalion, 6th Marines',
        subject: ack.subject,
        basicLetterId: 'CO 1stBn 6thMar ltr 5216 Ser 0123 of 15 Jan 25',
        endorsementOrdinal: 'FIRST',
        sigFirst: 'John',
        sigLast: 'DOE',
      },
      references: [],
      enclosures: [],
      paragraphs: ack.paragraphs,
      copyTos: [],
      distributions: [],
    } as never);

    expect(tex).toContain('FIRST ENDORSEMENT');
    expect(tex).toMatch(/read and understand/i);
    expect(tex).toMatch(/assume the duties/i);
  });
});
