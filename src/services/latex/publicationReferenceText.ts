import type { PublicationReference } from '@/lib/publicationReferences';
import { REFERENCE_TOKEN } from '@/lib/publicationReferences';
import { escapeLatex, escapeLatexUrl, processBodyText } from './escaper';
import { safeUrl } from '@/lib/url-safety';

export function publicationReferenceText(text: string, references: PublicationReference[], uppercase = false): string {
  const links: string[] = [];
  const save = (tex: string) => { const key = `ZZZPUBLICATIONLINK${links.length}ZZZ`; links.push(tex); return key; };
  let protectedText = text.replace(REFERENCE_TOKEN, (token) => {
    const target = references.find((r) => r.name === token.slice(2, -2));
    return target ? save(`\\dondocsReferenceLink{${target.destination}}{${escapeLatex(uppercase ? target.label.toUpperCase() : target.label)}}`) : 'MISSING REFERENCE';
  });
  protectedText = protectedText.replace(/https?:\/\/[^\s<>“”]+/g, (candidate) => {
    const url = candidate.replace(/[.,;:!?)]+$/, '');
    const suffix = candidate.slice(url.length);
    return safeUrl(url) ? save(`\\dondocsExternalLink{${escapeLatexUrl(url)}}{${escapeLatex(url)}}`) + suffix : candidate;
  });
  return processBodyText(uppercase ? protectedText.toUpperCase() : protectedText).replace(/ZZZPUBLICATIONLINK(\d+)ZZZ/g, (_, i) => links[Number(i)] ?? '');
}
