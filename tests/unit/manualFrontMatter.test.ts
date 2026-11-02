import { describe, expect, it } from 'vitest';
import { manualPacket, manualRequest } from '../_helpers/manualPacket';
import { manualFrontMatterErrors, manualFrontMatterFindings } from '@/lib/manualFrontMatterValidation';
import { emptyManualFrontMatter, MANUAL_TYPES } from '@/data/techpub/manualFrontMatter';
import { letterSchema } from '../../companion/letterSchema';
import { formatsFor, validateLetter } from '../../companion/validateLetter';
import { toStore } from '../../companion/letterInput';
import { prepareBatchCorrespondence } from '@/lib/batchDocument';
import { templateSession } from '@/lib/templateSession';
import { LETTER_TEMPLATES } from '@/data/templates';
import { sessionSearchFields } from '@/lib/workspaceSearch';

describe('manual front matter', () => {
  it.each(Object.keys(MANUAL_TYPES) as Array<keyof typeof MANUAL_TYPES>)('validates a complete %s without requiring I-Type paragraphs', (subtype) => {
    expect(manualFrontMatterErrors(manualPacket(1, subtype))).toEqual([]);
  });
  it('blocks missing fields, unsupported authority, date mismatch and contradictory release data', () => {
    const packet = manualPacket();
    Object.assign(packet.formData, { pcn: 'bad', publicationSigningDate: '2026-09-01', byDirection: true, sigTitle: 'Product Manager', classLevel: 'cui', cuiDistStatement: 'A', exportRestricted: true });
    const errors = manualFrontMatterErrors(packet).join(' ');
    for (const text of ['eleven digits', 'last working day', 'by direction', 'Program Manager', 'Public release', 'CUI category']) expect(errors).toContain(text);
  });
  it('requires real row content, stable IDs, and the source continuation capacity', () => {
    expect(manualFrontMatterErrors(manualPacket(0)).join(' ')).toContain('Add the equipment');
    expect(manualFrontMatterErrors(manualPacket(38))).toEqual([]);
    expect(manualFrontMatterErrors(manualPacket(39)).join(' ')).toContain('38 end items');
    const packet = manualPacket(2);
    packet.formData.manualFrontMatter!.endItems[1].rowId = packet.formData.manualFrontMatter!.endItems[0].rowId;
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('unique row ID');
  });
  it.each(['TM INVALID', 'TM 1234A-10', 'TM 12345I-10', 'TM 12345A-99', 'TM 12345A-10/1Q', 'TM 12345A-10/1 extra'])('refuses malformed assigned number %s', (shortTitle) => {
    const packet = manualPacket(); packet.formData.shortTitle = shortTitle;
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('Review the assigned short title');
  });
  it.each(['TM 12345A-10', 'TM 12345-12', 'TM 6115-20P/2B', 'TM 5215', 'TM 12345A-23&P', 'TM 12345A-10/1Y'])('accepts assigned number components in %s', (shortTitle) => {
    const packet = manualPacket(); packet.formData.shortTitle = shortTitle;
    expect(manualFrontMatterErrors(packet)).toEqual([]);
  });
  it('requires an approval basis for sponsor-assigned numbers', () => {
    const packet = manualPacket(); packet.formData.shortTitle = 'NAVAIR 01-1A-505-1';
    const m = packet.formData.manualFrontMatter!;
    m.shortTitleBasis = 'sponsor_assigned';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('assigning activity');
    m.shortTitleApproval = 'Test acquiring activity, approval TEST-1';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
    packet.formData.shortTitle = 'TM INVALID';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('numeric identifier');
  });
  it('requires verified authority, with an explicit applicable PdM delegation', () => {
    const packet = manualPacket(); const m = packet.formData.manualFrontMatter!;
    m.authorityBasis = 'unconfirmed';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('Confirm the signing authority');
    m.authorityBasis = 'pm_or_above'; packet.formData.sigTitle = 'Equipment Specialist';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('required publication authority');
    packet.formData.sigTitle = 'Product Manager'; m.authorityBasis = 'pdm_deviation';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('delegation or approval reference');
    m.authorityReference = 'Test office confirms applicable 21 March 2024 delegation, TEST-2';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
    packet.formData.sigTitle = 'Acting Program Manager'; m.authorityBasis = 'other_approved'; m.authorityReference = '';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('delegation or approval reference');
    m.authorityReference = 'Acting appointment TEST-3';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
    packet.formData.byDirection = true;
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('by direction');
  });
  it.each(['B', 'E'])('requires a rights determination for %s and refuses unsupported limited-rights packets', (statement) => {
    const packet = manualPacket(); const m = packet.formData.manualFrontMatter!;
    Object.assign(packet.formData, { cuiDistStatement: statement, distReason: 'Proprietary Business Information', distDate: '2026-10-01' });
    m.rightsAssessment = 'unreviewed';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('limited-rights');
    m.rightsAssessment = 'limited_rights';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('Limited Rights legend');
    m.rightsAssessment = 'not_required';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
  });
  it.each(['Product Manager (PdM)', 'PdM (Ground Systems)', 'Acting Product Manager'])('requires the applicable delegation for %s rather than a generic approval', (sigTitle) => {
    const packet = manualPacket();
    packet.formData.sigTitle = sigTitle;
    Object.assign(packet.formData.manualFrontMatter!, { authorityBasis: 'other_approved', authorityReference: 'Test approval' });
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('Product Manager authority requires');
    packet.formData.manualFrontMatter!.authorityBasis = 'pdm_deviation';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
  });
  it.each(['Program Manager, By-direction', 'Program Manager, by‑direction'])('refuses by-direction wording in %s', (sigTitle) => {
    const packet = manualPacket(); packet.formData.sigTitle = sigTitle;
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('by direction');
  });
  it.each(['Phone or email address', 'Name, Email, Phone, or Team/PM', 'XXXXX'])('refuses an unchanged source contact prompt: %s', (contentContact) => {
    const packet = manualPacket(); packet.formData.manualFrontMatter!.contentContact = contentContact;
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('template prompts');
  });
  it('requires the government-rights statement when copyright credit is supplied', () => {
    const packet = manualPacket(); packet.formData.manualFrontMatter!.copyrightCredit = '© 2026 Example Publisher. Example equipment guide.';
    expect(manualFrontMatterErrors(packet).join(' ')).toContain('government rights');
    packet.formData.manualFrontMatter!.governmentRights = 'Fictional test license: the Government may publish, reproduce and distribute this guide.';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
    const request = manualRequest();
    request.manualFrontMatter!.copyrightCredit = packet.formData.manualFrontMatter!.copyrightCredit;
    expect(validateLetter(letterSchema.parse(request)).join(' ')).toContain('government rights');
    request.manualFrontMatter!.governmentRights = packet.formData.manualFrontMatter!.governmentRights;
    expect(validateLetter(letterSchema.parse(request))).toEqual([]);
  });
  it('links source-prompt errors to their editor sections and ignores internal row IDs', () => {
    const packet = manualPacket();
    packet.formData.manualFrontMatter!.endItems[0].rowId = '#####';
    expect(manualFrontMatterErrors(packet)).toEqual([]);
    packet.formData.manualFrontMatter!.contentContact = 'Name,\nEmail, Phone, or Team/PM';
    Object.assign(packet.formData, { classLevel: 'cui', pocEmail: 'Phone or email address' });
    const prompts = manualFrontMatterFindings(packet).filter((f) => f.message.includes('template prompts'));
    expect(prompts.map((f) => f.section)).toEqual(['manual-notices', 'manual-authentication']);
  });
  it('checks active determinations while preserving unused draft fields', () => {
    const packet = manualPacket();
    Object.assign(packet.formData, { distReason: 'Export Controlled', pocEmail: 'Phone or email address', cuiDissemination: 'REL TO USA, LIST' });
    Object.assign(packet.formData.manualFrontMatter!, { authorityReference: 'XXXXX', shortTitleApproval: 'XXXXX' });
    expect(manualFrontMatterErrors(packet)).toEqual([]);
    packet.formData.classLevel = 'cui';
    expect(manualFrontMatterFindings(packet).some((f) => f.section === 'manual-notices' && f.message.includes('template prompts'))).toBe(true);
  });
  it('validates manual metadata through the same API gate, rejecting misspellings, body content and DOCX', () => {
    const request = manualRequest();
    expect(validateLetter(letterSchema.parse(request))).toEqual([]);
    expect(toStore(request).formData.manualFrontMatter).toEqual(manualPacket().formData.manualFrontMatter);
    expect(formatsFor(request.docType)).toEqual(['pdf']);
    expect(letterSchema.safeParse({ ...request, manualFrontMatter: { ...request.manualFrontMatter, subtype: 'digital_application' } }).success).toBe(false);
    expect(letterSchema.safeParse({ ...request, manualFrontMatter: { ...request.manualFrontMatter, pnc: 'typo' } }).success).toBe(false);
    expect(validateLetter({ ...request, format: 'docx' }).join(' ')).toContain('PDF only');
    expect(validateLetter({ ...request, paragraphs: [{ text: 'unprinted text' }] }).join(' ')).toContain('without body paragraphs');
    expect(validateLetter({ ...request, docType: 'naval_letter' }).join(' ')).toContain('requires docType');
  });
  it('keeps nested fields through a starter draft, search, and frozen batch substitution', async () => {
    const template = LETTER_TEMPLATES.find((t) => t.docType === 'tm_ietm_front_matter')!;
    const session = templateSession(template);
    session.formData = manualPacket().formData;
    session.formData.manualFrontMatter!.contentContact = '{{CONTACT}}';
    const result = await prepareBatchCorrespondence(session, { CONTACT: 'Test Program Office' });
    expect(result.formData.manualFrontMatter!.contentContact).toBe('Test Program Office');
    expect(session.formData.manualFrontMatter!.contentContact).toBe('{{CONTACT}}');
    const fields = sessionSearchFields(session);
    expect(fields.some((f) => f.text === 'MODEL-1' && f.sectionId === 'manual-items')).toBe(true);
    expect(fields.some((f) => f.text === '{{CONTACT}}' && f.sectionId === 'manual-authentication')).toBe(true);
    expect(emptyManualFrontMatter().endItems).toEqual([]);
  });
});

it.each(['[SUBJECT]', '[Equipment title]', '[Enter the publication title]'])('blocks the inherited prompt %s before PDF export', subject => {
  const packet = manualPacket(); packet.formData.subject = subject;
  expect(manualFrontMatterFindings(packet)).toContainEqual(expect.objectContaining({ section: 'manual-publication', fields: ['subject'] }));
  const request = manualRequest(); request.subject = subject;
  expect(validateLetter(letterSchema.parse(request)).join(' ')).toContain('template prompts');
});
