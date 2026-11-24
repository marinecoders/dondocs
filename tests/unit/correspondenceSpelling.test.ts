import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { spellingFindings } from '@/lib/correspondenceSpelling';
import type { ProofreadSource } from '@/lib/proofread';

const dictionary = new Set(readFileSync('src/data/spelling/english-us.txt', 'utf8').trim().split('\n'));
function source(text: string): ProofreadSource {
  return { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    formData: {}, paragraphs: [{ id: 'body', level: 0, text }], references: [], enclosures: [], copyTos: [], distributions: [] };
}

describe('local correspondence spelling', () => {
  it('finds representative transpositions with exact review locations and deduplicates within a field', () => {
    expect(spellingFindings(source('**Teh** ship recieved teh file.'), dictionary).map(f => [f.title, f.target.textSelection])).toEqual([
      ['Check spelling: Teh', { text: 'Teh', offset: 0 }], ['Check spelling: recieved', { text: 'recieved', offset: 9 }],
    ]);
  });
  it('leaves valid text, mail addresses, acronyms, local military terms and ambiguous unknown terms alone', () => {
    const draft = source('The warfighter and aircrew received the MARADMIN at teh@example.test or https://example.test/recieved. José spoke to Xzlzy.');
    expect(spellingFindings(draft, dictionary)).toEqual([]);
    expect(spellingFindings({ ...source('Teh ship.'), documentCategory: 'forms' }, dictionary)).toEqual([]);
  });
});
