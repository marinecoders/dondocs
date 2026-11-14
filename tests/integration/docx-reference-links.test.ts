import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { renderDocx } from '../../companion/renderDocx';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;

async function contents(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const document = parser.parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const relations = parser.parseFromString(await zip.file('word/_rels/document.xml.rels')!.async('string'), 'application/xml');
  const targets = new Map([...relations.getElementsByTagName('Relationship')]
    .filter(relation => relation.getAttribute('Type')?.endsWith('/hyperlink'))
    .map(relation => {
      expect(relation.getAttribute('TargetMode')).toBe('External');
      return [relation.getAttribute('Id'), relation.getAttribute('Target')];
    }));
  return {
    text: [...document.getElementsByTagName('w:t')].map(run => run.textContent).join(' '),
    links: [...document.getElementsByTagName('w:hyperlink')].map(link => ({
      text: [...link.getElementsByTagName('w:t')].map(run => run.textContent).join(''),
      url: targets.get(link.getAttribute('r:id')),
    })),
  };
}

describe.skipIf(!hasPandoc)('Word reference hyperlinks', () => {
  it.each([
    'naval_letter', 'same_page_endorsement', 'new_page_endorsement', 'joint_letter', 'standard_memorandum', 'executive_memorandum',
  ] as const)('keeps reference titles, labels and safe URL targets in %s', async docType => {
      const store = buildBaseline(docType);
      const title = 'H&S $5M: 100% readiness {revision} _annex_ ~ ^ \\ files';
      const url = 'https://example.com/order_a?left=1&right=2#section';
      store.formData.includeHyperlinks = false;
      store.formData.startingReferenceLetter = 'g';
      const letter = docType.includes('endorsement') ? 'g' : 'a';
      store.references = [{ letter, title, url }];
      const result = await compileDocxFixture(store);
      if (!result.ok) throw new Error(formatDocxFailure(docType, result));
      const output = await contents(result.docxBytes!);
      expect(output.links).toEqual([{ text: title, url }]);
      expect(output.text).toContain(title);
      if (!['standard_memorandum', 'executive_memorandum'].includes(docType)) expect(output.text).toContain(`(${letter})`);
    });

  it('preserves long, duplicate titles and special URL characters in source order', async () => {
    const store = buildBaseline('naval_letter');
    const title = 'Long reference title '.repeat(30).trim();
    const urls = ['https://example.com/a%20b/{section}/^/~/$/a_b?x=1&y=2#part',
      'https://example.com/ZZZURLBACKSLASHZZZ/\\literal', 'mailto:training@example.com?subject=Test&body=Hello',
      `https://example.com/long?value=${'value_'.repeat(700)}`];
    store.references = urls.map((url, index) => ({ letter: String.fromCharCode(97 + index), title, url }));
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure('special references', result));
    expect((await contents(result.docxBytes!)).links).toEqual(urls.map(url => ({ text: title, url: url.replace(/\\/g, '%5C') })));
  });

  it('leaves missing, malformed and unsafe URLs as plain titles', async () => {
    const store = buildBaseline('naval_letter');
    const urls = [undefined, '', 'javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,example', 'file:///tmp/example', 'vbscript:example', 'https://'];
    store.references = urls.map((url, index) => ({ letter: String.fromCharCode(97 + index), title: `Plain source ${index}`, url }));
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure('plain references', result));
    const output = await contents(result.docxBytes!);
    expect(output.links).toEqual([]);
    for (const reference of store.references) expect(output.text).toContain(reference.title);
  });

  it('does not expose references hidden by the document format', async () => {
    const store = buildBaseline('business_letter');
    store.references = [{ letter: 'a', title: 'Hidden source', url: 'https://example.com/hidden' }];
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure('business references', result));
    const output = await contents(result.docxBytes!);
    expect(output.links).toEqual([]);
    expect(output.text).not.toContain('Hidden source');
  });

  it('uses the same safe reference links in companion Word conversion', async () => {
    const bytes = await renderDocx({ docType: 'naval_letter', subject: 'REFERENCE LINKS', paragraphs: [{ text: 'Follow reference (b).' }],
      references: [{ letter: 'b', title: 'Bravo source', url: 'https://example.com/bravo?x=1&y=2' },
        { letter: 'a', title: 'Unsafe source', url: 'javascript:alert(1)' }] });
    const output = await contents(bytes);
    expect(output.links).toEqual([{ text: 'Bravo source', url: 'https://example.com/bravo?x=1&y=2' }]);
    expect(output.text).toContain('Unsafe source');
  });

  it('retains international reference titles and URI semantics in Word', async () => {
    const store = buildBaseline('naval_letter');
    const title = 'Directive été 漢字 😀';
    const url = 'https://例え.example/naïve/漢字/😀?clé=été#章';
    store.references = [{ letter: 'a', title, url }];
    const result = await compileDocxFixture(store);
    if (!result.ok) throw new Error(formatDocxFailure('international reference', result));
    const output = await contents(result.docxBytes!);
    expect(output.links).toHaveLength(1);
    expect(output.links[0].text).toBe(title);
    expect(new URL(output.links[0].url!).href).toBe(new URL(url).href);
  });
});
