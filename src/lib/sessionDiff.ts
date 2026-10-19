import type { SerializedSession } from '@/stores/documentStore';

export interface SessionChange { field: string; before: string; after: string }
const names: Record<string, string> = { formData: 'Document fields', forms: 'Form fields', navmc10274: 'NAVMC 10274', navmc11811: 'NAVMC 118 (11)', fileRef: 'Attached file', basicLetterFileRef: 'Basic letter', signatureImage: 'Signature image' };
const label = (key: string) => names[key] ?? (/^\d+$/.test(key) ? `${Number(key) + 1}` : key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()));

/** Compare every persisted field, including ordered structure and asset handles. */
export function diffSessions(before: SerializedSession, after: SerializedSession): SessionChange[] {
  const changes: SessionChange[] = [];
  function walk(a: unknown, b: unknown, path: string[]) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const key = path.at(-1);
    if (key === 'timestamp' || key === 'hasFile') return;
    if (key === 'signatureImage' || key === 'image') {
      changes.push({ field: path.map(label).join(' › '), before: a ? 'Image attached' : 'No image', after: b ? (a ? 'Different image attached' : 'Image attached') : 'No image' });
      return;
    }
    if (key === 'fileRef' || key === 'basicLetterFileRef') {
      const name = (v: unknown) => v && typeof v === 'object' && 'name' in v ? String(v.name) : 'No file';
      changes.push({ field: path.map(label).join(' › '), before: name(a), after: name(b) + (a && b ? ' (changed)' : '') });
      return;
    }
    if ((a && typeof a === 'object') || (b && typeof b === 'object')) {
      const left = (a ?? {}) as Record<string, unknown>;
      const right = (b ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[k], right[k], [...path, k]);
      return;
    }
    const text = (v: unknown) => v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
    changes.push({ field: path.map(label).join(' › '), before: text(a), after: text(b) });
  }
  walk(before, after, []);
  return changes;
}
