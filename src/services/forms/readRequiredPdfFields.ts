import { pdfjs } from 'react-pdf';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';

/** A signature attests to a revision. Required printed answers still have to be present. */
export async function readPdfAnswerStates(bytes: ArrayBuffer) {
  const task = pdfjs.getDocument({ ...HARDENED_PDF_OPTIONS, data: new Uint8Array(bytes.slice(0)), password: '' });
  try {
    const fields = await (await task.promise).getFieldObjects();
    const textValues = new Map<string, string>();
    const checked = new Set<string>(), unchecked = new Set<string>();
    const answered = new Set<string>();
    for (const [name, entries] of Object.entries(fields ?? {})) {
      // A non-widget parent can share the field name with its visible children.
      const widgets = entries.filter(entry => 'type' in entry && entry.type);

      // Repeated widgets must agree before a printed answer can identify another copy.
      const values = widgets.map(widget => 'value' in widget ? widget.value : undefined);
      const scalar = values.map(value => Array.isArray(value) && value.length === 1 ? value[0] : value);
      const first = scalar[0];
      if (typeof first === 'string' && scalar.every(value => value === first)) textValues.set(name, first);
      if (widgets.length && widgets.every(widget => 'type' in widget && widget.type === 'checkbox' &&
          'value' in widget && typeof widget.value === 'string' && widget.value !== '' && widget.value !== 'Off')) checked.add(name);
      if (widgets.length && widgets.every(widget => 'type' in widget && widget.type === 'checkbox' &&
          'value' in widget && widget.value === 'Off')) unchecked.add(name);
      if (widgets.some(field => {
        if (!('value' in field) || field.value == null) return false;
        const button = 'type' in field && (field.type === 'radiobutton' || field.type === 'checkbox');
        const values = Array.isArray(field.value) ? field.value : [field.value];
        return values.some(value => typeof value === 'string' && value.trim() !== '' &&
          (!button || value !== 'Off'));
      })) answered.add(name);
    }
    return { answered, checked, unchecked, textValues };
  } finally { await task.destroy(); }
}

export async function readAnsweredPdfFields(bytes: ArrayBuffer) {
  return (await readPdfAnswerStates(bytes)).answered;
}

export async function missingRequiredPdfFields(bytes: ArrayBuffer, names: string[]) {
  const answered = await readAnsweredPdfFields(bytes);
  return names.filter(name => !answered.has(name));
}

export function missingPdfSelections(fields: Awaited<ReturnType<typeof readPdfAnswerStates>>,
  selections: readonly { field: string; label: string; expected: boolean | string[] }[]) {
  return selections.filter(({ field, expected }) => typeof expected === 'boolean'
    ? !(expected ? fields.checked : fields.unchecked).has(field)
    : !expected.includes(fields.textValues.get(field) ?? ''));
}
