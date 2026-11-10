import { describe, expect, it } from 'vitest';
import { toStore } from '../../companion/letterInput';
import { companionPublication } from '../_helpers/companionPublication';
import { generateAllLatexFiles, generateCopyToTex, generateDistributionTex } from '@/services/latex/generator';
import { useDocumentStore } from '@/stores/documentStore';

// The reported I-Type ended with a letter's inherited Copy to recipients.
// Filter publication output without deleting the saved correspondence data.
describe('I-Type correspondence recipients', () => {
  it.each(['MI', 'TI', 'SI', 'LI'] as const)('omits inherited recipient lists from %s output', (type) => {
    const store = toStore(companionPublication(type));
    store.copyTos = [{ text: 'SYNTHETIC COPY RECIPIENT' }];
    store.distributions = [{ text: 'SYNTHETIC LETTER DISTRIBUTION' }];
    const original = structuredClone({ copyTos: store.copyTos, distributions: store.distributions });
    expect(generateCopyToTex(store)).not.toContain('SYNTHETIC');
    expect(generateDistributionTex(store)).not.toContain('SYNTHETIC');
    expect(Object.values(generateAllLatexFiles(store).texFiles).join('\n')).not.toContain('SYNTHETIC');
    expect({ copyTos: store.copyTos, distributions: store.distributions }).toEqual(original);
    store.docType = 'naval_letter';
    const letter = generateAllLatexFiles(store).texFiles;
    expect(letter['copyto-config.tex']).toContain('SYNTHETIC COPY RECIPIENT');
    expect(letter['distribution-config.tex']).toContain('SYNTHETIC LETTER DISTRIBUTION');
  });

  it.each(['compliant', 'custom'] as const)('also filters recipient lists in %s mode', (documentMode) => {
    const store = { ...toStore(companionPublication('TI')), documentMode, copyTos: [{ text: 'SYNTHETIC COPY' }], distributions: [{ text: 'SYNTHETIC DISTRIBUTION' }] };
    const files = generateAllLatexFiles(store).texFiles;
    expect(files['copyto-config.tex']).not.toContain('\\setHasCopyTo');
    expect(files['distribution-config.tex']).not.toContain('\\setHasDistribution');
    expect(files['document.tex']).toContain('\\setDistStatementFull{DISTRIBUTION STATEMENT A:');
  });

  it('retains recipients across actual document-type switches', () => {
    const original = useDocumentStore.getState();
    const copyTos = [{ text: 'SYNTHETIC SAVED COPY' }];
    const distributions = [{ text: 'SYNTHETIC SAVED DISTRIBUTION' }];
    try {
      useDocumentStore.setState({ docType: 'naval_letter', copyTos, distributions });
      useDocumentStore.getState().setDocType('i_type');
      expect(generateCopyToTex(useDocumentStore.getState())).not.toContain('SYNTHETIC');
      useDocumentStore.getState().setDocType('naval_letter');
      expect(generateCopyToTex(useDocumentStore.getState())).toContain('SYNTHETIC SAVED COPY');
      expect(generateDistributionTex(useDocumentStore.getState())).toContain('SYNTHETIC SAVED DISTRIBUTION');
      expect(useDocumentStore.getState()).toMatchObject({ copyTos, distributions });
    } finally { useDocumentStore.setState(original); }
  });
});
