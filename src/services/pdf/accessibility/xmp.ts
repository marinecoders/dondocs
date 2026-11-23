import { GENERATED_PDF_CREATOR, PDF_LIB_PRODUCER } from '../generatedPdfMetadata';

function xmlTitle(title: string): string {
  return Array.from(title, character => {
    const code = character.codePointAt(0)!;
    const allowed = code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff
      || code >= 0xe000 && code <= 0xfffd || code >= 0x10000;
    return allowed ? character : '\uFFFD';
  }).join('').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#13;');
}

export function taggedXmp(title: string, language: string): string {
  return [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + xmlTitle(title) + '</rdf:li></rdf:Alt></dc:title>',
    '<dc:language><rdf:Bag><rdf:li>' + language + '</rdf:li></rdf:Bag></dc:language>',
    '<xmp:CreatorTool>' + GENERATED_PDF_CREATOR + '</xmp:CreatorTool>',
    '<pdf:Producer>' + PDF_LIB_PRODUCER + '</pdf:Producer>',
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
  ].join('\n');
}
