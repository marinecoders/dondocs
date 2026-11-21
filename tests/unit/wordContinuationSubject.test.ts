import { describe, expect, it } from 'vitest';
import { extractSubjectFromDocument } from '@/services/docx/pandoc-converter';

describe('Word continuation subject text', () => {
  it('preserves authored nonbreaking spaces inside the subject', () => {
    const xml = '<w:p><w:r><w:t>Subj: OPERATION\u00a0ORDER\u202f17</w:t></w:r></w:p>';
    expect(extractSubjectFromDocument(xml)).toBe('Subj:  OPERATION\u00a0ORDER\u202f17');
  });

  it('decodes escaped text once before constructing a continuation header', () => {
    const xml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Subj:</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p><w:r><w:t>R&amp;D &lt;TRAINING&gt; &amp;lt;EXAMPLE&amp;gt;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    expect(extractSubjectFromDocument(xml)).toBe('Subj:  R&D <TRAINING> &lt;EXAMPLE&gt;');
  });

  it('keeps words separated across subject line breaks and tabs', () => {
    const xml = '<w:p><w:r><w:t>SUBJECT: FIRST</w:t><w:br/><w:t>SECOND</w:t>'
      + '<w:tab/><w:t>THIRD</w:t></w:r></w:p>';
    expect(extractSubjectFromDocument(xml)).toBe('SUBJECT:  FIRST SECOND THIRD');
  });

  it('recognizes table cells with attributes without falling through to only the label', () => {
    const xml = '<w:tbl><w:tr w:rsidR="1234"><w:tc w:rsidR="1234"><w:p><w:r><w:t>Subj:</w:t></w:r></w:p></w:tc>'
      + '<w:tc w:rsidR="1234"><w:p><w:r><w:t>COMPLETE SUBJECT</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    expect(extractSubjectFromDocument(xml)).toBe('Subj:  COMPLETE SUBJECT');
  });
});
