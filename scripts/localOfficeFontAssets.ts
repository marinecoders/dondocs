import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { OFFICE_FONT_ENCODING, OFFICE_FONT_FACES, OFFICE_FONT_FILES, OFFICE_FONT_UNICODE, type OfficeFontAssets } from '../src/services/officeFonts.ts';

export function readLocalOfficeFontAssets(): OfficeFontAssets {
  const directory = process.env.DONDOCS_LOCAL_OFFICE_FONT_DIR ?? '/System/Library/Fonts/Supplemental';
  const kpsewhich = process.env.DONDOCS_LOCAL_KPSEWHICH ?? '/Library/TeX/texbin/kpsewhich';
  const texFile = (filename: string) => execFileSync(kpsewhich, [filename], { encoding: 'utf8' }).trim();
  const unicodeMappings = readFileSync(texFile('glyphtounicode.tex'), 'utf8');
  const codepoints = new Map([...unicodeMappings.matchAll(/\\pdfglyphtounicode\{([^{} ]+)\}\{([\dA-F]{4})\}/g)]
    .map(([, name, hex]) => [name, hex]));
  // The installed Times Bold can associate a familiar PostScript name with the
  // wrong outline. pdfTeX resolves uniXXXX through the font's Unicode cmap.
  const baseEncoding = readFileSync(texFile('8r.enc'), 'utf8');
  const encoding = baseEncoding.replace(/^(\/TeXBase1Encoding\s*\[)([\s\S]+?)(\])/m, (_array, start: string, entries: string, end: string) =>
    start + entries.replace(/\/([\w.]+)/g, (name, glyph: string) =>
      glyph !== 'space' && codepoints.has(glyph) ? '/uni' + codepoints.get(glyph) : name) + end);
  if (encoding === baseEncoding) throw new Error('The TeX 8r encoding could not be mapped to Unicode.');
  return Object.fromEntries(OFFICE_FONT_FILES.map(filename => {
    if (filename === OFFICE_FONT_ENCODING) return [filename, new TextEncoder().encode(encoding)] as const;
    if (filename === OFFICE_FONT_UNICODE) return [filename, new TextEncoder().encode(unicodeMappings)] as const;
    const face = OFFICE_FONT_FACES.find(entry => entry.program === filename);
    const path = face ? join(directory, face.diskName) : texFile(filename);
    const bytes = readFileSync(path);
    if (face && fontkit.create(bytes).postscriptName !== face.postScriptName) {
      throw new Error(`Unexpected PostScript name in ${path}. Expected ${face.postScriptName}.`);
    }
    return [filename, new Uint8Array(bytes)] as const;
  })) as OfficeFontAssets;
}
