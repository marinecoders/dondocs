import { pdfjs } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';

/** A signature attests to a revision. Required printed answers still have to be present. */
export async function readAnsweredPdfFields(bytes: ArrayBuffer): Promise<Set<string>> {
  const task = pdfjs.getDocument({ ...HARDENED_PDF_OPTIONS, data: new Uint8Array(bytes.slice(0)), password: '' });
  try {
    const fields = await (await task.promise).getFieldObjects();
    const answered = new Set<string>();
    for (const [name, widgets] of Object.entries(fields ?? {})) {
      if (widgets.some(field => {
        if (!('value' in field) || field.value == null) return false;
        const button = 'type' in field && (field.type === 'radiobutton' || field.type === 'checkbox');
        const values = Array.isArray(field.value) ? field.value : [field.value];
        return values.some(value => typeof value === 'string' && value.trim() !== '' &&
          (!button || value !== 'Off'));
      })) answered.add(name);
    }
    return answered;
  } finally { await task.destroy(); }
}

export async function missingRequiredPdfFields(bytes: ArrayBuffer, names: string[]) {
  const answered = await readAnsweredPdfFields(bytes);
  return names.filter(name => !answered.has(name));
}
