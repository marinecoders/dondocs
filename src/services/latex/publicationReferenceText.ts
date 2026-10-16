import type { PublicationReference } from '@/lib/publicationReferences';
import { REFERENCE_TOKEN, EXTERNAL_PUBLICATION_LINK } from '@/lib/publicationReferences';
import { escapeLatex, escapeLatexUrl, processBodyText } from './escaper';
import { safeUrl } from '@/lib/url-safety';

export function publicationReferenceText(text: string, references: PublicationReference[], uppercase = false, literal = processBodyText): string {
  const links: string[] = [];
  const save = (tex: string) => { const key = `ZZZPUBLICATIONLINK${links.length}ZZZ`; links.push(tex); return key; };
  let protectedText = text.replace(REFERENCE_TOKEN, (token) => {
    const target = references.find((r) => r.name === token.slice(2, -2));
    if (!target) return 'MISSING REFERENCE';
    const label = target.kind === 'N' ? target.note! : (uppercase ? target.label.toUpperCase() : target.label);
    const link = `\\dondocsReferenceLink{${target.destination}}{${escapeLatex(label)}}`;
    return save(target.kind === 'N' ? `\\textsuperscript{${link}}` : link);
  });
  protectedText = protectedText.replace(EXTERNAL_PUBLICATION_LINK, (match, label, url) => safeUrl(url)
    ? save(`\\dondocsExternalLink{${escapeLatexUrl(url)}}{${escapeLatex(uppercase ? label.toUpperCase() : label)}}`) : match);
  protectedText = protectedText.replace(/https?:\/\/[^\s<>“”]+/g, (candidate) => {
    const url = candidate.replace(/[.,;:!?)]+$/, '');
    const suffix = candidate.slice(url.length);
    return safeUrl(url) ? save(`\\dondocsExternalLink{${escapeLatexUrl(url)}}{${escapeLatex(url)}}`) + suffix : candidate;
  });
  return literal(uppercase ? protectedText.toUpperCase() : protectedText).replace(/ZZZPUBLICATIONLINK(\d+)ZZZ/g, (_, i) => links[Number(i)] ?? '');
}
