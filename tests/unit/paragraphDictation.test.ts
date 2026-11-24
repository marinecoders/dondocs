import { describe, expect, it } from 'vitest';
import { appendDictatedText, planParagraphDictation } from '@/lib/paragraphDictation';

describe('reviewed paragraph dictation', () => {
  it('preserves spoken command names until the user elects to interpret them', () => {
    const text = 'The phrase new paragraph indent command period';
    expect(planParagraphDictation(text, false)).toEqual([{ text, indent: false }]);
    expect(planParagraphDictation(text, true)).toEqual([{ text: 'The phrase new paragraph indent.', indent: false }]);
  });
  it('handles explicit punctuation, leading structural commands and case', () => {
    expect(planParagraphDictation('COMMAND NEW PARAGRAPH Command indent New entry command comma reviewed command question mark', true)).toEqual([
      { text: '', indent: false }, { text: 'New entry, reviewed?', indent: true },
    ]);
    expect(appendDictatedText('Prior text', '.')).toBe('Prior text.');
    expect(appendDictatedText('Prior text.', 'More text.')).toBe('Prior text. More text.');
  });
});

it('preserves spoken leading and consecutive line breaks when appending to existing text', () => {
  const [part] = planParagraphDictation('command new line command new line Additional text command period', true);
  expect(appendDictatedText('Prior text.', part.text)).toBe('Prior text.\n\nAdditional text.');
  expect(planParagraphDictation('command new line', true)).toEqual([{ text: '', indent: false }]);
  expect(planParagraphDictation('Words command new line command period', true)[0].text).toBe('Words\n.');
});
