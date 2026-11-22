import type { LetterTemplate } from '../types';

/** Content guides, not issued correspondence. Replace every bracketed field. */
export const interimResponse: LetterTemplate = {
  id: 'executive-interim-response', name: 'Interim Response', category: 'Executive Correspondence',
  description: 'Acknowledge a request, explain the delay, and give the expected reply date and action officer. Based on Chapter 12, figure 12-2; uses your own letterhead.',
  docType: 'executive_correspondence', subject: '', manualFigure: { number: '12-2', pdfPage: 121 },
  correspondenceDefaults: { fontSize: '12pt', fontFamily: 'times', stationerySize: 'letter', letterheadMode: 'full',
    to: '[RECIPIENT NAME]\n[TITLE OR ORGANIZATION]\n[MAILING ADDRESS]', salutation: 'Dear [RECIPIENT]:', complimentaryClose: 'Sincerely,' },
  paragraphs: [
    { level: 0, text: 'Thank you for your [DATE] correspondence regarding [SUBJECT]. Your request is being reviewed by [RESPONSIBLE OFFICE].' },
    { level: 0, text: 'We need additional time to [REASON FOR DELAY]. We expect to provide a final response by [EXPECTED REPLY DATE].' },
    { level: 0, text: 'Please contact [ACTION OFFICER NAME AND TITLE] at [PHONE OR EMAIL] if you have questions in the meantime.' },
  ],
};

export const congressionalInterim: LetterTemplate = {
  id: 'executive-congressional-interim', name: 'Congressional Interim Response', category: 'Executive Correspondence',
  description: 'Acknowledge a congressional inquiry while a complete response is being prepared. Chapter 12, figure 12-3. Verify the member’s current title and address; House salutations use a courtesy title.',
  docType: 'executive_correspondence', subject: '', manualFigure: { number: '12-3', pdfPage: 122 },
  correspondenceDefaults: { fontSize: '12pt', fontFamily: 'times', stationerySize: 'letter', letterheadMode: 'full',
    to: 'The Honorable [FULL NAME]\n[UNITED STATES SENATE OR HOUSE OF REPRESENTATIVES]\n[OFFICE ADDRESS]', salutation: 'Dear [SENATOR OR COURTESY TITLE] [LAST NAME]:', complimentaryClose: 'Sincerely,' },
  paragraphs: [
    { level: 0, text: 'Thank you for your [DATE] letter concerning [SUBJECT OR CONSTITUENT REQUEST].' },
    { level: 0, text: '[RESPONSIBLE OFFICE] is reviewing this matter. We expect to provide a complete response by [EXPECTED REPLY DATE].' },
    { level: 0, text: 'Your interest in this matter is appreciated. [ACTION OFFICER NAME AND CONTACT] is available for any interim questions.' },
  ],
};

export const congressionalResponse: LetterTemplate = {
  id: 'executive-congressional-response', name: 'Congressional Response', category: 'Executive Correspondence',
  description: 'Prepare a substantive response to a member or committee chairperson. Chapter 12, figure 12-4. Confirm addressing, releasability, and any companion responses before sending.',
  docType: 'executive_correspondence', subject: '', manualFigure: { number: '12-4', pdfPage: 123 },
  correspondenceDefaults: { fontSize: '12pt', fontFamily: 'times', stationerySize: 'letter', letterheadMode: 'full',
    to: 'The Honorable [FULL NAME]\n[COMMITTEE AND CHAMBER, IF APPLICABLE]\n[OFFICE ADDRESS]', salutation: 'Dear [APPROPRIATE TITLE] [LAST NAME]:', complimentaryClose: 'Sincerely,' },
  paragraphs: [
    { level: 0, text: 'Thank you for your [DATE] letter regarding [SUBJECT].' },
    { level: 0, text: '[PROVIDE THE VERIFIED RESPONSE, SUPPORTING FACTS, AND ANY ACTION TAKEN OR PLANNED.]' },
    { level: 0, text: '[IDENTIFY ANY SIMILAR RESPONSE OR COPY RECIPIENTS WHEN APPLICABLE.] Thank you for your continued interest in [SUBJECT].' },
  ],
};

export const secnavFlagStationery: LetterTemplate = {
  id: 'executive-secnav-flag-stock', name: 'SECNAV Flag Stationery — Preprinted 7 × 9', category: 'Executive Correspondence',
  description: 'Personal correspondence on authorized preprinted 7 × 9-inch SECNAV flag stock (figure 12-7). The file leaves the letterhead blank and does not reproduce flag artwork. Do not use for routine official correspondence.',
  docType: 'executive_correspondence', subject: '', manualFigure: { number: '12-7', pdfPage: 126 },
  correspondenceDefaults: { fontSize: '12pt', fontFamily: 'times', stationerySize: '7x9', letterheadMode: 'preprinted',
    to: '[RECIPIENT NAME]\n[MAILING ADDRESS]', salutation: 'Dear [RECIPIENT]:', complimentaryClose: 'Sincerely,' },
  paragraphs: [{ level: 0, text: '[WRITE YOUR PERSONAL MESSAGE. CONFIRM THE RECIPIENT, DATE, AND SIGNER BEFORE PRINTING ON AUTHORIZED FLAG STATIONERY.]' }],
};

export const cnoFlagStationery: LetterTemplate = {
  id: 'executive-cno-flag-stock', name: 'CNO Flag Stationery — Preprinted 5 × 7', category: 'Executive Correspondence',
  description: 'A short personal note on authorized preprinted 5 × 7-inch CNO flag stock (figure 12-8). The file leaves the letterhead blank and does not reproduce flag artwork.',
  docType: 'executive_correspondence', subject: '', manualFigure: { number: '12-8', pdfPage: 127 },
  correspondenceDefaults: { fontSize: '12pt', fontFamily: 'times', stationerySize: '5x7', letterheadMode: 'preprinted',
    to: '[RECIPIENT NAME]\n[MAILING ADDRESS]', salutation: 'Dear [RECIPIENT]:', complimentaryClose: 'Sincerely,' },
  paragraphs: [{ level: 0, text: '[WRITE A SHORT PERSONAL NOTE.]' }],
};

export const executiveTemplates = [interimResponse, congressionalInterim, congressionalResponse, secnavFlagStationery, cnoFlagStationery];
