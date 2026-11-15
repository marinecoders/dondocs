import type { Paragraph } from '@/types/document';
import type { TestStore } from './compileLatex';
import { buildBaseline } from './compileMatrix';
import { docxImageFixture } from './docxImageFixture';

export interface WordLayoutFixture {
  name: string;
  store: TestStore;
  figure?: Uint8Array;
  markers: string[];
}

/** Shared synthetic inputs for native compilation and manual Word printing. */
export async function wordLayoutFixtures(): Promise<WordLayoutFixture[]> {
  const images = await docxImageFixture();
  const naval = buildBaseline('naval_letter');
  naval.formData = { ...naval.formData, subject: 'WORD LAYOUT QUALIFICATION',
    pageNumbering: 'simple', startingPageNumber: 3, showSubjectOnContinuation: true };
  naval.references = Array.from({ length: 12 }, (_, index) => ({ letter: String.fromCharCode(97 + index),
    title: `REFERENCE${index} Synthetic publication for a fictional training organization, including a deliberately long explanatory title that wraps in the reference table.` }));
  const wrap = 'This synthetic sentence deliberately wraps to another line so the continuation margin can be measured against the paragraph designator. ';
  naval.paragraphs = Array.from({ length: 6 }, (_, level) => ({ level, text: `DEPTH${level} ${wrap.repeat(2)}` }));
  naval.paragraphs.push(...Array.from({ length: 14 }, (_, index) => ({ level: 0, text: `BODY${index} ${wrap.repeat(2)}` })));

  const references = buildBaseline('naval_letter');
  references.formData.subject = 'LONG REFERENCE TABLE QUALIFICATION';
  references.references = Array.from({ length: 24 }, (_, index) => ({ letter: String.fromCharCode(97 + index),
    title: `LONGREFERENCE${index} Synthetic publication title that deliberately spans multiple lines within one reference cell. ${wrap}` }));
  references.paragraphs = [{ level: 0, text: 'AFTERREFERENCES This final paragraph must follow the complete reference table.' }];

  const business = buildBaseline('business_letter');
  business.documentMode = 'custom';
  business.formData = { ...business.formData, subject: 'BUSINESS FIGURE QUALIFICATION',
    signatureType: 'image', signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } };
  business.paragraphs = Array.from({ length: 8 }, (_, index): Paragraph => ({ level: 0, text: `BUSINESS${index} ${wrap}` }));
  business.paragraphs.splice(2, 0, { level: 0, text: 'QUALIFICATIONFIGURE Synthetic training diagram',
    figure: { name: 'figure.png', type: 'image/png', fileRef: { id: 'qualification-figure', name: 'figure.png', type: 'image/png', size: images.figure.length } } });

  const joint = buildBaseline('joint_letter');
  joint.formData = { ...joint.formData, subject: 'JOINT SIGNATURE QUALIFICATION', signatureType: 'image', signatureImageSigner: 'senior',
    signatureImage: { name: 'signature.png', size: images.signature.length, data: images.signature.toString('base64') } };
  joint.paragraphs = Array.from({ length: 13 }, (_, index) => ({ level: 0, text: `JOINT${index} ${wrap}` }));
  return [
    { name: 'naval-deep', store: naval, markers: [...Array.from({ length: 6 }, (_, index) => `DEPTH${index}`), ...Array.from({ length: 14 }, (_, index) => `BODY${index}`), ...Array.from({ length: 12 }, (_, index) => `REFERENCE${index}`)] },
    { name: 'naval-long-references', store: references, markers: ['AFTERREFERENCES', ...Array.from({ length: 24 }, (_, index) => `LONGREFERENCE${index}`)] },
    { name: 'business-figure', store: business, figure: images.figure, markers: ['QUALIFICATIONFIGURE', ...Array.from({ length: 8 }, (_, index) => `BUSINESS${index}`)] },
    { name: 'joint-senior', store: joint, markers: Array.from({ length: 13 }, (_, index) => `JOINT${index}`) },
  ];
}
