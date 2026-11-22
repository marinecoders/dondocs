import { getSectionError } from '@/components/layout/editorSections';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { describe, expect, it } from 'vitest';
import { LETTER_TEMPLATES } from '@/data/templates';
import { executiveTemplates } from '@/data/templates/executive';
import { templateSession } from '@/lib/templateSession';
import { parseSavedSession } from '@/lib/savedSession';

describe('Chapter 12 content guides', () => {
  it('registers five distinct templates using the existing executive format', () => {
    expect(executiveTemplates).toHaveLength(5);
    expect(new Set(LETTER_TEMPLATES.map(template => template.id)).size).toBe(LETTER_TEMPLATES.length);
    for (const template of executiveTemplates) {
      expect(LETTER_TEMPLATES).toContain(template);
      expect(template.docType).toBe('executive_correspondence');
      expect(template.subject).toBe('');
      expect(template.paragraphs.every(paragraph => paragraph.level === 0 && paragraph.text.includes('['))).toBe(true);
    }
  });
  it.each(executiveTemplates)('opens $name independently with profile identity and qualified defaults', template => {
    const profile = { unitLine1: 'MY COMMAND', sigLast: 'MY SIGNER', fontSize: '10pt', fontFamily: 'courier' };
    const session = templateSession(template, profile);
    expect(session.formData).toMatchObject({ unitLine1: 'MY COMMAND', sigLast: 'MY SIGNER', fontSize: '12pt', fontFamily: 'times', ...template.correspondenceDefaults });
    expect(session.enclosures).toEqual([]);
    expect(session.distributions).toEqual([]);
    expect(session.copyTos).toEqual([]);
    expect(parseSavedSession(session).formData).toMatchObject(template.correspondenceDefaults!);
    session.paragraphs[0].text = 'Edited';
    expect(template.paragraphs[0].text).not.toBe('Edited');
    expect(profile.fontSize).toBe('10pt');
  });
  it('does not flag an optional subject on executive or business letters', () => {
    for (const type of ['executive_correspondence', 'business_letter']) {
      expect(getSectionError('addressing', { to: 'TRAINING RECIPIENT', subject: '' }, [], DOC_TYPE_CONFIG[type])).toBe(false);
    }
    expect(getSectionError('addressing', { from: 'SENDER', to: 'RECIPIENT', subject: '' }, [], DOC_TYPE_CONFIG.naval_letter)).toBe(true);
  });
  it('maps actual manual figures and leaves flag artwork to authorized preprinted stock', () => {
    expect(executiveTemplates.map(template => template.manualFigure)).toEqual([
      { number: '12-2', pdfPage: 121 }, { number: '12-3', pdfPage: 122 }, { number: '12-4', pdfPage: 123 },
      { number: '12-7', pdfPage: 126 }, { number: '12-8', pdfPage: 127 },
    ]);
    const flags = executiveTemplates.slice(3);
    expect(flags.map(template => template.correspondenceDefaults?.stationerySize)).toEqual(['7x9', '5x7']);
    expect(flags.every(template => template.correspondenceDefaults?.letterheadMode === 'preprinted' && /preprinted/i.test(template.name))).toBe(true);
  });
});
