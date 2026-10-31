/** Map export feedback to the editor where the author can correct it. */
export function sl3ErrorSection(message: string): string {
  if (/^(Signatory|Signing authority title|Select a digital signature|SL-3 authentication)/i.test(message)) return 'signature';
  if (/^(Item \d+:|Component IDs|Add the SL-3 components|Identify the Fielding Plan)/i.test(message)) return 'sl3-inventory';
  if (/technical data|source technical manual|TFSMS configuration|special notes?|definition|abbreviation|List items alphabetically/i.test(message)) return 'sl3-details';
  if (/illustration|^Figure \d+|graphic separately/i.test(message)) return 'sl3-figures';
  if (/classification|classifier|classified|declassif|CUI|Distribution Statement|distribution determination|dissemination|designation block/i.test(message)) return 'classification';
  // Publication identity, dates, end items and unrecognized errors stay reachable.
  return 'sl3-cover';
}

export const SL3_ERROR_BEARING_IDS = [
  'sl3-cover', 'classification', 'sl3-details', 'sl3-inventory', 'sl3-figures', 'signature',
] as const;
