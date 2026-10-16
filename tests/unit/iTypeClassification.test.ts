import { describe, expect, it } from 'vitest';
import { iTypeClassificationErrors } from '@/lib/iTypeClassification';
import type { DocumentData, Paragraph } from '@/types/document';

const data: Partial<DocumentData> = { classLevel: 'secret', classificationBasis: 'derivative', classifiedBy: 'Synthetic reviewer, Program Office', derivedFrom: 'Synthetic guide, 20261015', declassifyOn: '20361015' };
const paragraphs: Paragraph[] = [{ level: 0, text: 'Synthetic content.', portionMarking: 'S' }];

describe('I-Type classification authority', () => {
  it('rejects custom banners that bypass controlled markings', () => {
    const custom = { classLevel: 'custom', customClassification: 'TRAINING' };
    expect(iTypeClassificationErrors(custom, paragraphs).join(' ')).toContain('Custom I-Type');
    expect(iTypeClassificationErrors(custom, [{ ...paragraphs[0], portionMarking: 'U', figure: { portionMarking: 'S' } }]).join(' ')).toContain('Custom I-Type');
    for (const customClassification of ['CUI', 'TOP SECRET', 'FOR OFFICIAL USE ONLY']) {
      expect(iTypeClassificationErrors({ ...custom, customClassification }, []).join(' ')).toContain('Custom I-Type');
    }
    expect(iTypeClassificationErrors(custom, [{ ...paragraphs[0], portionMarking: 'U' }])).toEqual([]);
    expect(iTypeClassificationErrors({ classLevel: 'unknown' }, []).join(' ')).toContain('recognized');
  });
  it('requires the applicable original or derivative fields', () => {
    expect(iTypeClassificationErrors(data, paragraphs)).toEqual([]);
    expect(iTypeClassificationErrors({ ...data, derivedFrom: '' }, paragraphs).join(' ')).toContain('source');
    expect(iTypeClassificationErrors({ ...data, classificationBasis: 'original', derivedFrom: '', classReason: '1.4(a)' }, paragraphs)).toEqual([]);
    expect(iTypeClassificationErrors({ ...data, classificationBasis: 'original' }, paragraphs).join(' ')).toContain('reason');
    expect(iTypeClassificationErrors({ ...data, classificationBasis: undefined, classifiedBy: '', declassifyOn: '' }, paragraphs)).toHaveLength(3);
  });
  it('validates dates without treating authorized instructions as dates', () => {
    for (const declassifyOn of ['2036-10-15', '20360230']) expect(iTypeClassificationErrors({ ...data, declassifyOn }, paragraphs).join(' ')).toContain('YYYYMMDD');
    expect(iTypeClassificationErrors({ ...data, declassifyOn: '25X1, 20501015' }, paragraphs)).toEqual([]);
  });
  it('requires heading, paragraph, caption and separate graphic markings', () => {
    expect(iTypeClassificationErrors(data, [{ level: 0, header: 'Purpose', text: '' }]).join(' ')).toContain('every');
    expect(iTypeClassificationErrors(data, [{ ...paragraphs[0], figure: {} }]).join(' ')).toContain('graphic');
    expect(iTypeClassificationErrors({ ...data, classLevel: 'unclassified' }, paragraphs).join(' ')).not.toContain('Select original');
    expect(iTypeClassificationErrors({ classLevel: 'cui' }, [{ level: 0, text: 'Unmarked CUI paragraph.' }])).toEqual([]);
  });
});
