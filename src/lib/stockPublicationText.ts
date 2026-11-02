/** Authoring prompts must be replaced before a stock publication is exported. */
export function stockPublicationPrompt(value: string): boolean {
  return /\[[A-Za-z][^\]\n]{1,250}\]|\{\{[^}]+\}\}|\bINSERT (?:LONG TITLE|NOMENCLATURE)(?: HERE)?\b|\bDD Month YYYY\b|\((?:SELECT|CHOOSE)[^)\n]{1,120}\)|\b(?:NAME OF SIGNING OFFICIAL|END ITEM GRAPHIC GOES HERE|ITEM GRAPHIC GOES HERE)\b|#{3,}|\bx{5,}\b/i.test(value);
}
