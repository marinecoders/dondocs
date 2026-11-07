const templateBrand = Symbol('form-export-templates');
export interface FormExportTemplates {
  readonly [templateBrand]: true;
  readonly kind: 'builtin-form' | 'configured-form';
  readonly formType: string;
  readonly definitionIdentity?: string;
}
const templates = new WeakMap<FormExportTemplates, Readonly<Record<string, Uint8Array>>>();

/** Own template bytes before review. Neither loaders nor renderers receive the
 * retained buffers, so a retry cannot pick up a different template revision. */
export function captureFormExportTemplates(kind: FormExportTemplates['kind'], formType: string, pages: Readonly<Record<string, Uint8Array>>, definitionIdentity?: string): FormExportTemplates {
  if (kind === 'configured-form' && !definitionIdentity) throw new Error('Configured templates require a definition identity.');
  const owned: Record<string, Uint8Array> = {};
  if (!formType || !Object.keys(pages).length) throw new Error('Form templates are missing.');
  for (const [file, bytes] of Object.entries(pages)) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error(`Form template is empty: ${file}`);
    owned[file] = new Uint8Array(bytes);
  }
  const result: FormExportTemplates = Object.freeze({ [templateBrand]: true as const, kind, formType, definitionIdentity });
  templates.set(result, owned);
  return result;
}
export function copyFormExportTemplates(value: FormExportTemplates): Record<string, Uint8Array> {
  const pages = templates.get(value);
  if (!pages) throw new Error('Form templates were not captured by the export boundary.');
  return Object.fromEntries(Object.entries(pages).map(([file, bytes]) => [file, new Uint8Array(bytes)]));
}
