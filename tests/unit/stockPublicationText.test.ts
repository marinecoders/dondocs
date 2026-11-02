import { describe, expect, it } from 'vitest';
import { stockPublicationPrompt } from '@/lib/stockPublicationText';
import { sl3ExportErrors } from '@/lib/sl3Preflight';
import { sl4ExportErrors, sl4ErrorSection } from '@/lib/sl4Preflight';
import { sl4ContentFindings } from '@/lib/sl4Validation';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import { sl4Fixture } from '../_helpers/sl4Fixture';

describe('stock publication prompt checks', () => {
  it.each(['sl3', 'sl4'] as const)('checks shared %s cover, authentication and caption text', type => {
    const store = type === 'sl3' ? sl3Fixture() : sl4Fixture();
    store.formData.subject = 'PARTS FOR [END ITEM]';
    store.formData.sigTitle = 'Program Manager, {{OFFICE}}';
    store.formData.supersedure = 'Supersedes (SELECT PUBLICATION)';
    store.paragraphs.push({ level: 0, text: 'INSERT NOMENCLATURE HERE', figure: {} });
    const errors = (type === 'sl3' ? sl3ExportErrors(store) : sl4ExportErrors(store));
    expect(errors).toEqual(expect.arrayContaining([
      'Long title: replace the remaining template prompt before export.',
      'Signing authority title: replace the remaining template prompt before export.',
      'Supersedure notice: replace the remaining template prompt before export.',
      expect.stringMatching(/^Figure \d+: replace the remaining template prompt/),
    ]));
  });

  it('checks SL-4 definitions and searchable artwork labels while preserving stable IDs', () => {
    const data = sl4Fixture().formData.sl4!;
    data.definitions = [{ id: '{{stable-definition-id}}', term: 'ABC', meaning: 'Meaning for [TERM]', portionMarking: 'U' }];
    data.notes[0].text = 'Prepared for {{UNIT}}';
    data.artwork[0].labels = [{ id: '{{stable-label-id}}', text: 'Label for [COMPONENT]', x: 50, y: 50 }];
    const paths = sl4ContentFindings(data).filter(finding => finding.code === 'template-prompt')
      .map(finding => finding.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['definitions.0.meaning', 'notes.0.text', 'artwork.0.labels.0.text']));
    expect(paths.some(path => path.endsWith('.id'))).toBe(false);
  });

  it('allows ordinary technical punctuation and routes feedback to the correct editor', () => {
    expect(stockPublicationPrompt('BRACKET, Type A: use position [2]; 24 VDC.')).toBe(false);
    expect(sl4ErrorSection('Long title: replace the remaining template prompt before export.')).toBe('sl4-cover');
    expect(sl4ErrorSection('Figure 2: replace the remaining template prompt in its title before export.')).toBe('sl4-figures');
    expect(sl4ErrorSection('artwork.0.labels.0.text: Replace the remaining source-template prompt before publication.')).toBe('sl4-figures');
    expect(sl4ErrorSection('Signing authority title: replace the remaining template prompt before export.')).toBe('signature');
  });
});
