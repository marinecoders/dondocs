import type { TestStore } from './compileLatex';
import type { PublicationVolume } from '@/lib/publicationVolume';
import type { DocumentMode, EndItem, PublicationTableRow } from '@/types/document';

export function volumeFixture(dense = false): TestStore & { documentMode: DocumentMode; endItems: EndItem[]; publicationTables: Record<string, PublicationTableRow[]> } {
  const volume: PublicationVolume = {
    version: 1, includeContents: true,
    chapters: [
      { id: 'chapter-intro', title: 'Introduction', sections: [{ id: 'section-intro', title: 'Purpose' }] },
      { id: 'chapter-maintenance', title: 'Maintenance', sections: [{ id: 'section-checks', title: 'Daily checks' }] },
    ],
    appendices: [{ id: 'appendix-data', title: 'Reference data', sections: [{ id: 'section-data', title: 'Limits' }] }],
    glossary: [{ id: 'term', term: 'Controller', definition: 'The portable example controller.' }],
    changes: [{ id: 'change', number: '1', date: '2026-11-20', description: 'Initial synthetic qualification fixture.' }],
  };
  return {
    docType: 'technical_volume', documentMode: 'compliant',
    formData: { docType: 'technical_volume', volume, subject: 'QUALIFICATION VOLUME', shortTitle: 'TEST-VOL-001', date: '20 Nov 26', fontFamily: 'times', fontSize: '10pt', classLevel: 'unclassified', signatureType: 'none' },
    paragraphs: [
      { id: 'intro', volumeSectionId: 'section-intro', level: 0, text: 'Original introduction. Continue with {{VOLREF_checks}}.' },
      { id: 'checks', volumeSectionId: 'section-checks', level: 0, text: 'Verify the synthetic controller. Refer to {{VOLREF_limits}}.' },
      ...(dense ? Array.from({ length: 60 }, (_, index) => ({ id: `body-${index}`, volumeSectionId: 'section-checks', level: 0, text: `Body record ${index + 1}. ` + 'Inspect the controller and record the observed condition. '.repeat(8) })) : []),
      { id: 'table', volumeSectionId: 'section-checks', level: 0, text: 'Measured values', bodyTable: { headerRows: 1, rows: [['Measurement', 'Result'], ...Array.from({ length: dense ? 80 : 2 }, (_, index) => [`READBACK-${index + 1}`, `Value ${index + 1}`])] } },
      { id: 'limits', volumeSectionId: 'section-data', level: 0, text: 'Appendix content retained. Return to {{VOLREF_intro}}.' },
    ],
    references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  };
}
