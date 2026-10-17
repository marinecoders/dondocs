import { renderFormPdf, type PageLoader } from '@/services/pdf/genericFormRenderer';
import type { FormConfig, FormValues } from '@/types/formConfig';
import { compileFormDefinition, validateAnswers, diagnosticText, type FormInstance, type Placement, type AnswerField, type Answer, type FormDiagnostic } from './model';
import { loadPackagePage } from './packages';

export interface FormRenderResult { bytes: Uint8Array; diagnostics: FormDiagnostic[] }
export async function renderForm(instance: FormInstance, mode: 'preview' | 'export', loader?: PageLoader): Promise<FormRenderResult> {
  const d = compileFormDefinition(instance.definition);
  const diagnostics = validateAnswers(d, instance.answers, instance.rows, mode === 'export');
  const config: FormConfig = { id: d.formId, label: d.label, directory: d.directory, pages: d.pages.map(p => p.file), sections: [], fields: {} };
  const values: FormValues = {};
  const paths: Record<string, string> = {};
  const overflow: Record<string, 'error' | 'shrink'> = {};
  let placementIndex = 0;
  const add = (p: Placement, field: AnswerField, answer: Answer | undefined, path: string) => {
    const key = `p${placementIndex++}`;
    config.fields[key] = { type: p.appearance === 'mark' ? 'checkbox' : field.kind === 'signature' ? 'signature' : 'text', label: field.label, page: p.page, box: p.box, multiline: field.multiline };
    paths[key] = path;
    overflow[key] = p.overflow;
    if (answer === undefined || (typeof answer === 'string' && !answer.trim()) || (Array.isArray(answer) && !answer.length)) return;
    if (p.appearance === 'mark') values[key] = p.optionId ? Array.isArray(answer) ? answer.includes(p.optionId) : answer === p.optionId : answer === true;
    else if (typeof answer === 'boolean') values[key] = answer ? 'Yes' : 'No';
    else if (field.options) values[key] = (Array.isArray(answer) ? answer : [answer]).map(v => field.options!.find(o => o.id === v)?.label ?? v).join(', ');
    else if (field.kind === 'date' && typeof answer === 'string' && p.dateFormat && p.dateFormat !== 'iso') {
      const [year, month, day] = answer.split('-');
      values[key] = p.dateFormat === 'mdy' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
    } else values[key] = String(answer);
  };
  for (const p of d.placements) add(p, d.fields[p.fieldId], instance.answers[p.fieldId], p.fieldId);
  for (const [key, group] of Object.entries(d.rowGroups)) for (const [i, row] of (instance.rows[key] ?? []).entries()) for (const p of group.rows[i] ?? []) add(p, group.columns[p.fieldId], row.answers[p.fieldId], `${key}.${i}.${p.fieldId}`);
  const renderIssues: FormDiagnostic[] = [];
  const bytes = await renderFormPdf(config, values, {}, loader ?? ((_directory, file) => loadPackagePage(d, file)), renderIssues, overflow);
  diagnostics.push(...renderIssues.map(i => ({ ...i, path: paths[i.path] ?? i.path })));
  if (mode === 'export' && diagnostics.some(i => i.severity === 'error')) throw new Error(diagnostics.map(i => diagnosticText(d, i)).join('\n'));
  return { bytes, diagnostics };
}
