import { describe, expect, it } from 'vitest';
import { validatePublicationTableRows } from '@/lib/publicationTableValidation';
import { generateBodyTex } from '@/services/latex/generator';
import { useDocumentStore } from '@/stores/documentStore';

const row = { values: { item: '1', description: 'BOLT', pn: 'ABC123 (1AB23)', nsn: '', qty: '2' } };
describe('publication table content', () => {
  it('does not treat identification details alone as an empty row', () => {
    const errors = validatePublicationTableRows('materielRequired', [{ values: {}, identificationException: 'Unmarked shim.' }]);
    expect(errors.join(' ')).toContain('description');
    expect(errors.join(' ')).toContain('quantity');
  });
  it('keeps software versions separate from stock identifiers', () => {
    const software = { values: { ...row.values, pn: '', softwareVersion: 'v2.4.1' } };
    expect(validatePublicationTableRows('materielRequired', [software], 'software')).toEqual([]);
    expect(validatePublicationTableRows('materielRequired', [{ values: { ...software.values, pn: 'ABC123' } }], 'software').join(' ')).toContain('without assigned');
    expect(validatePublicationTableRows('materielRequired', [software], 'stock').join(' ')).toContain('select the software/firmware');
  });
  it('requires quantity and a CAGE when no NSN is assigned', () => {
    expect(validatePublicationTableRows('materielRequired', [row])).toEqual([]);
    expect(validatePublicationTableRows('materielRequired', [{ values: { ...row.values, pn: 'ABC123', qty: '' } }])).toHaveLength(2);
    expect(validatePublicationTableRows('materielRequired', [{ values: { ...row.values, nsn: '1005-01-566-1100', pn: 'ABC123' } }])).toEqual([]);
    expect(validatePublicationTableRows('materielRetained', [{ values: { ...row.values, nsn: 'invalid' } }]).join(' ')).toContain('thirteen-digit');
  });
  it('accepts last-resort identification only for unnumbered required materiel', () => {
    const exception = { values: { ...row.values, pn: '' }, identificationException: 'Unmarked shim supplied with this assembly; no identifiers assigned.' };
    expect(validatePublicationTableRows('materielRequired', [exception])).toEqual([]);
    expect(validatePublicationTableRows('materielDiscarded', [exception]).join(' ')).toContain('last-resort');
    expect(validatePublicationTableRows('materielRequired', [{ ...row, identificationException: 'Not applicable.' }]).join(' ')).toContain('last-resort');
    const tex = generateBodyTex({ ...useDocumentStore.getState(), docType: 'i_type', paragraphs: [{ level: 0, text: '', header: 'Materiel Required', tableKey: 'materielRequired' }], publicationTables: { materielRequired: [exception] } });
    expect(tex).toContain('Unmarked shim supplied');
  });
  it('requires manufacturer details for an open-purchase special tool', () => {
    expect(validatePublicationTableRows('specialTools', [{ ...row, openPurchase: { manufacturer: 'Synthetic supplier', address: '' } }]).join(' ')).toContain('manufacturer');
    expect(validatePublicationTableRows('specialTools', [{ ...row, openPurchase: { manufacturer: 'Synthetic supplier', address: '123 Example Road, Quantico, VA 22134' } }])).toEqual([]);
  });
});
