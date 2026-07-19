import { describe, it, expect } from 'vitest';
import { detectClassification, CLASSIFICATION_LABELS } from '@/lib/detectClassification';

describe('detectClassification — banner level', () => {
  it('reads a SECRET banner from a standalone line', () => {
    const d = detectClassification(['SECRET', '', 'From: A', '', '1. Body.', '', 'SECRET'].join('\n'));
    expect(d).toMatchObject({ classLevel: 'secret', found: true });
  });

  it('reads CONFIDENTIAL', () => {
    expect(detectClassification('CONFIDENTIAL\n\n1. Body.').classLevel).toBe('confidential');
  });

  it('reads CUI (and the spelled-out form)', () => {
    expect(detectClassification('CUI\n1. x').classLevel).toBe('cui');
    expect(detectClassification('CONTROLLED UNCLASSIFIED INFORMATION\n1. x').classLevel).toBe('cui');
  });

  it('distinguishes TOP SECRET from SECRET', () => {
    expect(detectClassification('TOP SECRET\n1. x').classLevel).toBe('top_secret');
  });

  it('reads TOP SECRET//SCI as its own level', () => {
    expect(detectClassification('TOP SECRET//SCI\n1. x').classLevel).toBe('top_secret_sci');
  });

  it('tolerates a dissemination trailer on the banner (SECRET//NOFORN)', () => {
    expect(detectClassification('SECRET//NOFORN\n1. x').classLevel).toBe('secret');
  });

  it('takes the highest marking when several appear (highest wins)', () => {
    // A page footer might read UNCLASSIFIED while a header reads SECRET.
    const d = detectClassification(['SECRET', '1. x', 'UNCLASSIFIED'].join('\n'));
    expect(d.classLevel).toBe('secret');
  });

  it('tolerates whitespace around the // control separator', () => {
    expect(detectClassification('TOP SECRET // SCI\n1. x').classLevel).toBe('top_secret_sci');
  });

  it('reads a legacy FOUO banner as CUI', () => {
    expect(detectClassification('FOR OFFICIAL USE ONLY\n1. x').classLevel).toBe('cui');
    expect(detectClassification('UNCLASSIFIED//FOUO\n1. x').classLevel).toBe('cui');
  });

  it('detects a banner that appears only once (single-page document)', () => {
    const d = detectClassification('SECRET\n\nFrom: A\n\n1. Body.');
    expect(d).toMatchObject({ classLevel: 'secret', found: true });
  });
});

describe('detectClassification — false positives', () => {
  it('does not treat "SECRETARY OF THE NAVY" as a SECRET banner', () => {
    const d = detectClassification('From: SECRETARY OF THE NAVY\n\n1. Body.');
    expect(d.found).toBe(false);
    expect(d.classLevel).toBe('unclassified');
  });

  it('does not fire on the word secret mid-sentence', () => {
    const d = detectClassification('1. Keep this a secret between us.');
    expect(d.found).toBe(false);
  });

  it('does not treat a prose line that merely starts with the word as a banner', () => {
    // The trailer must start with "//" — plain trailing words are not a banner.
    expect(detectClassification('SECRET SERVICE DETAIL ASSIGNMENTS').found).toBe(false);
    expect(detectClassification('CONFIDENTIAL sources report the following.').found).toBe(false);
    expect(detectClassification('TOP SECRETARY DUTIES').found).toBe(false);
  });

  it('reports not-found for a plain unmarked letter', () => {
    const d = detectClassification('From: A\nTo: B\nSubj: C\n\n1. Body.');
    expect(d).toMatchObject({ found: false, classLevel: 'unclassified' });
  });
});

describe('detectClassification — derivative classification authority block', () => {
  it('captures Classified by / Derived from / Declassify on / Reason', () => {
    const d = detectClassification(
      [
        'SECRET',
        '',
        '1. Body.',
        '',
        'Classified by: Director, Naval Intelligence',
        'Derived from: OPNAV SCG 5510.1',
        'Declassify on: 20501231',
        'Reason: 1.4(c)',
        '',
        'SECRET',
      ].join('\n')
    );
    expect(d.classLevel).toBe('secret');
    expect(d.classifiedBy).toBe('Director, Naval Intelligence');
    expect(d.derivedFrom).toBe('OPNAV SCG 5510.1');
    expect(d.declassifyOn).toBe('20501231');
    expect(d.classReason).toBe('1.4(c)');
  });

  it('finds an authority block even with no clean banner, and asks to confirm', () => {
    const d = detectClassification('Derived from: Multiple Sources\nDeclassify on: 20301231');
    expect(d.found).toBe(true);
    expect(d.derivedFrom).toBe('Multiple Sources');
    expect(d.reason).toMatch(/confirm/i);
  });
});

describe('detectClassification — labels', () => {
  it('has a label for every classification level', () => {
    for (const level of ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'] as const) {
      expect(CLASSIFICATION_LABELS[level]).toBeTruthy();
    }
  });
});
