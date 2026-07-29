import { describe, it, expect } from 'vitest';
import { humanizeGroup } from '@/lib/humanizeGroup';

describe('humanizeGroup', () => {
  it('humanizes the field-name segment of a qualified radio-group slug', () => {
    expect(humanizeGroup('form1_0_subform_1_MAPRecommendations_0')).toBe('MAP Recommendations');
    expect(humanizeGroup('form1_0_subform_0_Payment_0')).toBe('Payment');
    expect(humanizeGroup('p_0_Page1_0_CardTypeList_0')).toBe('Card Type');
  });

  it('drops LiveCycle container GUIDs and keeps only the last field segment', () => {
    expect(humanizeGroup('63623_Page6_0_Performed_01_0_0')).toBe('Performed');
  });

  it('strips widget prefixes/suffixes (Rad, Button) and glued indices', () => {
    expect(humanizeGroup('a_0_PaymentButton_0')).toBe('Payment');
    expect(humanizeGroup('q_0_Rad12YesRifle_0')).toBe('Yes Rifle');
    expect(humanizeGroup('topmostSubform_0_Page1_0_Rad6East_0')).toBe('East');
  });

  it('gates junk to null (renders no heading — status quo) rather than a fake question', () => {
    expect(humanizeGroup('')).toBeNull();
    expect(humanizeGroup('radio')).toBeNull();
    expect(humanizeGroup('form1_0_subform_1_RadioButton_0')).toBeNull();
    expect(humanizeGroup('x_0_RadioButtonList_0')).toBeNull();
    expect(humanizeGroup('form1_0_subform_1_F_0')).toBeNull(); // single-letter field
    expect(humanizeGroup('a_0_yes_0')).toBeNull(); // lone stopword
  });

  it('never emits a scaffold word or a stray single letter', () => {
    const outputs = [
      'topmostSubform_0_Page1_0_Figure_0_CardTypeList_0',
      'form1_0_subform_1_QQAPBaeCADAAC_Performed_01_0_0',
    ].map(humanizeGroup);
    for (const o of outputs) {
      if (o === null) continue;
      expect(o).not.toMatch(/\b(topmost|subform|page|figure)\b/i);
      expect(o).not.toMatch(/\b[a-z]\b/i); // no lone single letters
    }
  });
});
