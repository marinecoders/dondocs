import { describe, expect, it } from 'vitest';
import { decodeXmlText } from '../../scripts/form-quality';

describe('PDF word decoding', () => {
  it('decodes each XML entity once, preserving literal entity names in form answers', () => {
    expect(decodeXmlText('&amp;lt; &lt; &gt; &quot; &apos; &#38;lt; &#x26;gt;')).toBe('&lt; < > " \' &lt; &gt;');
    expect(decodeXmlText('A&#32;B &#x1F600;')).toBe('A B 😀');
  });

  it('leaves unknown and invalid entities intact', () => {
    expect(decodeXmlText('&unknown; &#0; &#xD800; &#1114112;')).toBe('&unknown; &#0; &#xD800; &#1114112;');
  });
});
