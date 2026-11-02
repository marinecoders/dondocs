import { escapeLatex } from './escaper';

const text = (value: string) => escapeLatex(value).replace(/\r?\n/g, '\\par ');

/** Preserve ordinary words; add break points only when a token exceeds its line. */
export const stockDefinitionText = (value: string) => value
  .split(/(\s+)/)
  .filter(Boolean)
  .map(token => /^\s+$/.test(token)
    ? /[\r\n]/.test(token) ? '\\par\n' : '\n'
    : `\\slThreeDefinitionWord{${text(token)}}{${Array.from(token).map(text).join('\\allowbreak\n')}}`)
  .join('');
