import { buildBaseline } from './compileMatrix';

export function headquartersFixture(type: 'standard_memorandum' | 'executive_memorandum' = 'standard_memorandum') {
  const store = buildBaseline(type);
  Object.assign(store.formData, {
    fontFamily: 'times', fontSize: '12pt',
    memorandumFor: 'DIRECTOR FOR EXPEDITIONARY TRAINING AND OPERATIONAL READINESS COORDINATION\nRUNOVERSTART TRAINING SUPPORT COMMAND RUNOVEREND',
    attnLine: 'ATTNSTART Senior Military Assistant for Expeditionary Training and Operational Readiness Coordination\nATTNTAIL Training Support Division',
    throughLine: 'CHIEF OF STAFF',
    sigTitle: 'Director, Training Support Division',
  });
  store.paragraphs = [0, 1, 2, 2, 1, 0].map((level, i) => ({ level,
    text: `BODY${i}START Training staff coordinate the review and return consolidated comments. The review confirms responsibilities for each participating command. BODY${i}END` }));
  return store;
}
