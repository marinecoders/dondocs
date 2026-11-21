import { buildBaseline } from './compileMatrix';

/** The exported header must preserve the subject at every supported font size. */
export function wordContinuationFixtures() {
  return (['times', 'courier'] as const).flatMap(fontFamily =>
    (['10pt', '11pt', '12pt'] as const).map(fontSize => {
      const name = `continuation-${fontFamily}-${fontSize}`;
      const store = buildBaseline('naval_letter');
      store.formData = { ...store.formData, fontFamily, fontSize,
        subject: 'R&D <TRAINING> &LT;EXAMPLE&GT; WITH A LONG SUBJECT THAT WRAPS ACROSS THE AVAILABLE HEADER WIDTH',
        showSubjectOnContinuation: true, pageNumbering: 'simple' };
      const markers = Array.from({ length: 24 }, (_, index) => `CONTINUATION${index}`);
      store.paragraphs = markers.map(marker => ({ level: 0, text: `${marker} ${'This synthetic training paragraph exercises continued pages and wrapped text. '.repeat(3)}` }));
      return { name, store, markers };
    }));
}
