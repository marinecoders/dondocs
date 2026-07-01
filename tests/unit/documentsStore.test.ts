import { describe, it, expect } from 'vitest';
import { isMeaningful, deriveTitle, sameContent, profileFormPatch, importShouldReplace, searchableText } from '@/stores/documentsStore';
import type { SerializedSession } from '@/stores/documentStore';
import { docTypeChip, type Profile } from '@/types/document';

// Minimal valid session; the helpers read a few fields, but the type needs the
// full shape.
function mkSession(o: Partial<SerializedSession> = {}): SerializedSession {
  return {
    documentMode: 'compliant',
    documentCategory: 'correspondence',
    docType: 'naval_letter',
    formType: 'navmc_10274',
    formData: {},
    references: [],
    enclosures: [],
    paragraphs: [],
    copyTos: [],
    distributions: [],
    timestamp: 0,
    ...o,
  } as SerializedSession;
}

describe('isMeaningful — keeps blank starter docs out of Recents', () => {
  it('a blank starter (placeholder subject + placeholder paragraph) is NOT meaningful', () => {
    const s = mkSession({
      formData: { subject: '[SUBJECT]' },
      paragraphs: [{ text: '[Your content here. Click Templates to load a format.]' }] as never,
    });
    expect(isMeaningful(s)).toBe(false);
  });

  it('a real subject makes it meaningful', () => {
    expect(isMeaningful(mkSession({ formData: { subject: 'REQUEST FOR SPECIAL LIBERTY' } }))).toBe(true);
  });

  it('a real body paragraph makes it meaningful', () => {
    expect(isMeaningful(mkSession({ paragraphs: [{ text: 'The Marine requests...' }] as never }))).toBe(true);
  });

  it('empty subject + empty paragraph is NOT meaningful', () => {
    expect(
      isMeaningful(mkSession({ formData: { subject: '' }, paragraphs: [{ text: '   ' }] as never }))
    ).toBe(false);
  });
});

describe('deriveTitle — labels the recent from the document', () => {
  it('uses the subject line when present', () => {
    expect(deriveTitle(mkSession({ formData: { subject: 'LETTER OF APPRECIATION' } }))).toBe(
      'LETTER OF APPRECIATION'
    );
  });

  it('truncates a very long subject with an ellipsis', () => {
    const t = deriveTitle(mkSession({ formData: { subject: 'A'.repeat(100) } }));
    expect(t.length).toBe(70);
    expect(t.endsWith('…')).toBe(true);
  });

  it('falls back to the doc-type label for a placeholder subject', () => {
    expect(deriveTitle(mkSession({ formData: { subject: '[SUBJECT]' }, docType: 'naval_letter' }))).toMatch(
      /draft$/
    );
  });
});

describe('sameContent — a load/reset round-trip never counts as a change', () => {
  it('ignores the save timestamp', () => {
    expect(sameContent(mkSession({ timestamp: 1 }), mkSession({ timestamp: 999 }))).toBe(true);
  });

  it('ignores enclosure hasFile so attachment docs do not re-sort to the top on reload', () => {
    // serialize emits hasFile:true; loadSharedSession drops it (file:undefined ->
    // re-serialize hasFile:false). Must be treated as the same content.
    const a = mkSession({ enclosures: [{ title: 'PFT Scorecard', hasFile: true }] as never });
    const b = mkSession({ enclosures: [{ title: 'PFT Scorecard', hasFile: false }] as never });
    expect(sameContent(a, b)).toBe(true);
  });

  it('still detects a real content change (different paragraph)', () => {
    expect(
      sameContent(
        mkSession({ paragraphs: [{ text: 'one' }] as never }),
        mkSession({ paragraphs: [{ text: 'two' }] as never })
      )
    ).toBe(false);
  });

  it('still detects a subject change', () => {
    expect(
      sameContent(mkSession({ formData: { subject: 'A' } }), mkSession({ formData: { subject: 'B' } }))
    ).toBe(false);
  });
});

describe('profileFormPatch — a signer-less profile must not blank the document signature', () => {
  const mkProfile = (o: Partial<Profile> = {}): Profile => ({
    unitLine1: '1ST BATTALION, 6TH MARINES',
    unitLine2: '',
    unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
    ssic: '1500',
    from: 'Commanding Officer',
    sigFirst: '',
    sigMiddle: '',
    sigLast: '',
    sigRank: '',
    sigTitle: '',
    ...o,
  });

  it('omits the signature block when the profile has no signer (so the spread keeps the doc signature)', () => {
    const patch = profileFormPatch(mkProfile({ sigFirst: '', sigLast: '' }));
    expect('sigFirst' in patch).toBe(false);
    expect('sigLast' in patch).toBe(false);
    expect('signatureImage' in patch).toBe(false);
    // …but letterhead/identity fields are still applied.
    expect(patch.unitLine1).toBe('1ST BATTALION, 6TH MARINES');
    expect(patch.ssic).toBe('1500');
  });

  it('applies the signature block when the profile carries a signer', () => {
    const patch = profileFormPatch(mkProfile({ sigFirst: 'J', sigLast: 'DOE', sigRank: 'Colonel' }));
    expect(patch.sigFirst).toBe('J');
    expect(patch.sigLast).toBe('DOE');
    expect(patch.sigRank).toBe('Colonel');
  });

  it('treats a whitespace-only name as no signer', () => {
    const patch = profileFormPatch(mkProfile({ sigFirst: '  ', sigLast: '   ' }));
    expect('sigLast' in patch).toBe(false);
  });
});

describe('searchableText — Recents search matches more than the title', () => {
  const entry = {
    meta: { id: 'x', title: 'Liberty Request', docType: 'naval_letter', updatedAt: 1 },
    session: mkSession({
      formData: { subject: 'REQUEST FOR SPECIAL LIBERTY', to: 'Commanding Officer', ssic: '1710' },
      paragraphs: [{ text: 'Request approval for weekend liberty.', level: 0 }],
      references: [{ title: 'MCO 1050.3J', url: '' }],
    }),
  } as Parameters<typeof searchableText>[0];

  it('matches on the recipient, SSIC, body, and references — not just the title', () => {
    const text = searchableText(entry);
    expect(text).toContain('commanding officer');
    expect(text).toContain('1710');
    expect(text).toContain('weekend liberty');
    expect(text).toContain('mco 1050.3j');
  });
});

describe('docTypeChip — a scannable code per doc type', () => {
  it('maps known types and falls back to DOC', () => {
    expect(docTypeChip('naval_letter')).toBe('LTR');
    expect(docTypeChip('same_page_endorsement')).toBe('END');
    expect(docTypeChip('mfr')).toBe('MFR');
    expect(docTypeChip('action_memorandum')).toBe('MEMO');
    expect(docTypeChip('nonexistent_type')).toBe('DOC');
  });
});

describe('importShouldReplace — restoring a backup never clobbers newer work', () => {
  it('imports a doc that does not exist yet', () => {
    expect(importShouldReplace(undefined, 100)).toBe(true);
  });
  it('keeps the local copy when it is newer than the backup', () => {
    expect(importShouldReplace(200, 100)).toBe(false);
  });
  it('overwrites when the backup is newer or equal', () => {
    expect(importShouldReplace(100, 200)).toBe(true);
    expect(importShouldReplace(100, 100)).toBe(true);
  });
});
