import { describe, it, expect } from 'vitest';
import { validateAppendixTitles } from '@/lib/appendixTitles';

describe('appendix titles', () => {
  it('letters findings by appendix order, skipping titled ones', () => {
    const f = validateAppendixTitles([
      { text: '', level: 0, header: 'Torque Values', appendix: true },
      { text: '', level: 0, header: '  ', appendix: true },
      { text: 'plain', level: 0 },
      { text: '', level: 0, appendix: true },
    ]);
    expect(f.map((x) => x.message)).toEqual([
      'Appendix B has no title. Its heading is the title.',
      'Appendix C has no title. Its heading is the title.',
    ]);
  });

  it('has nothing to say without appendices', () => {
    expect(validateAppendixTitles([{ text: 'x', level: 0 }])).toEqual([]);
  });
});
