import { buildBaseline } from './compileMatrix';

export function endorsementFooterFixture(lines: number, start: number) {
  const store = buildBaseline('new_page_endorsement');
  Object.assign(store.formData, { fontFamily: 'times', fontSize: '12pt', pageNumbering: 'simple', startingPageNumber: start,
    showSubjectOnContinuation: true,
    subject: Array.from({ length: lines }, () => 'COORDINATION OF TRAINING AND READINESS REQUIREMENTS').join(' '),
  });
  store.references = [];store.enclosures = [];
  store.paragraphs = Array.from({ length: 12 }, () => ({ level: 0,
    text: 'Training staff coordinate schedules and review command responsibilities. '.repeat(3) }));
  return store;
}
