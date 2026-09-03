import { describe, it, expect } from 'vitest';
import {
  validateHeadingAcronyms, validateCalloutOrder, validateUrgencyByType, validateTiWording,
  validateNomenclatureCase, validateItemNumbers, validateReadingGrade, readingGrade,
} from '@/lib/publicationRules';

const p = (text: string, extra: object = {}) => ({ text, level: 0, ...extra });

describe('MIL-DTL-28999D text rules', () => {
  it('keeps acronyms out of headings, and leaves all-caps headings alone', () => {
    expect(validateHeadingAcronyms([p('', { header: 'GCSS-MC Reporting' })])[0].message).toMatch(/GCSS-MC in "GCSS-MC Reporting"/);
    expect(validateHeadingAcronyms([p('', { header: 'Purpose' }), p('', { header: 'PROCEDURES' })])).toEqual([]);
  });

  it('orders callouts by importance when they run together', () => {
    expect(validateCalloutOrder([p('a', { callout: 'note' }), p('b', { callout: 'warning' })])[0].message).toMatch(/WARNING follows a NOTE/);
    expect(validateCalloutOrder([p('a', { callout: 'warning' }), p('b', { callout: 'caution' }), p('c', { callout: 'note' })])).toEqual([]);
    expect(validateCalloutOrder([p('a', { callout: 'note' }), p('step', { procedure: true }), p('b', { callout: 'warning' })])).toEqual([]);
  });

  it('lets only a modification be URGENT', () => {
    expect(validateUrgencyByType('TI', 'urgent')[0].message).toMatch(/A TI is not published as time-restrictive/);
    expect(validateUrgencyByType('MI', 'urgent')).toEqual([]);
    expect(validateUrgencyByType('SI', 'normal')).toEqual([]);
  });

  it('keeps "modification" out of a Technical Instruction', () => {
    expect(validateTiWording('TI', [p('Perform the modification.'), p('Then test.')])[0].message).toMatch(/1 paragraph uses it/);
    expect(validateTiWording('MI', [p('Perform the modification.')])).toEqual([]);
  });

  it('checks nomenclature case: capitals to the first comma, then each word capitalized', () => {
    const rows = (d: string) => [{ values: { description: d } }];
    expect(validateNomenclatureCase(rows('TRAILER ASSEMBLY, Generator, Environmental Control Unit, Tent'), 'Major Items Affected')).toEqual([]);
    expect(validateNomenclatureCase(rows('COMBAT OPERATIONS CENTER, AN/TSQ-239(V)4'), 'Major Items Affected')).toEqual([]);
    expect(validateNomenclatureCase(rows('Trailer assembly, generator'), 'Major Items Affected')[0].message).toMatch(/Trailer assembly, generator/);
    expect(validateNomenclatureCase(rows('RIFLE, 7.62mm sniper'), 'Components Affected')[0].message).toMatch(/Components Affected/);
  });

  it('wants item numbers consecutive, kit items included', () => {
    const rows = (...items: string[]) => items.map((item) => ({ values: { item } }));
    expect(validateItemNumbers(rows('1', '2', '3'), 'materielRequired')).toEqual([]);
    expect(validateItemNumbers(rows('1', '1a', '2'), 'materielRequired')[0].message).toMatch(/they read 1, 1a, 2/);
    expect(validateItemNumbers([{ values: { description: 'x' } }], 'materielRequired')).toEqual([]);
  });

  it('estimates the reading grade and reports only a clear excess', () => {
    const plain = Array.from({ length: 12 }, () => p('Remove the stock. Loosen the two screws. Lift the action clear.'));
    expect(readingGrade(plain)).not.toBeNull();
    expect(validateReadingGrade(plain)).toEqual([]);
    const dense = Array.from({ length: 6 }, () => p('Notwithstanding the aforementioned considerations regarding the reconfiguration of the environmental subsystem, personnel shall subsequently reinitialize the diagnostic instrumentation in accordance with the applicable documentation'));
    expect(validateReadingGrade(dense)[0].message).toMatch(/reads at about grade \d+; the specification asks for the ninth grade/);
    expect(validateReadingGrade([p('Short.')])).toEqual([]);
  });
});
