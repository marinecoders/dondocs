import { coordinationTable, staffDecisionOfficials, staffDecisionOptions } from '@/lib/staffPapers';
import type { DocumentData } from '@/types/document';
import { renderBodyTable } from './bodyTable';
import { bodyTableLiteral } from './bodyTableText';

type Escape = (value: string) => string;

export function staffPaperLayout(docType: string, data: Partial<DocumentData>, escape: Escape, word = false, hints?: Partial<Record<'subject' | 'date' | 'officeCode' | 'preparedBy', string>>) {
  const center = (value: string) => '\\noindent\\begin{tabularx}{\\textwidth}{@{}XcX@{}} & ' + value + ' & \\\\ \\end{tabularx}\n\n';
  const line = (label: string, value?: string, hint?: string) => hint || value?.trim() ? '\\noindent ' + label + ' ' + (hint || escape(value?.trim() ?? '')) + '\\par\n\n' : '';

  if (docType === 'coordination_page') {
    const hqmc = data.coordinationLayout === 'hqmc';
    const table = renderBodyTable(coordinationTable(data),
      word ? text => text.split('\n').map(escape).join('\\newline ') : text => bodyTableLiteral(text),
      { ...(word ? { repeatHeaders: false, wordIndex: 0 } : {}), ...(!hqmc ? { headerStyle: 'underline' as const } : {}) });
    const body = word ? table : '{\\setlength{\\parskip}{0pt}\n' + table + '}\n';
    const heading = center('COORDINATION PAGE') + (hqmc ? line('Subj:', data.subject?.toUpperCase(), hints?.subject) : '');
    const comments = hqmc ? (data.coordinationComments ?? '').trim().split('\n').filter(Boolean) : [];
    const divider = word ? '\\dondocscoordinationdivider' : '\\noindent\\rule{\\textwidth}{0.4pt}';
    const closing = comments.length
      ? '\n\n' + divider + '\n\n\\noindent Staffing Comments:\\par\n\n' + comments.map(comment => line('', comment)).join('')
      : '';
    return { heading, body, closing };
  }

  const decision = docType === 'position_decision_paper';
  const meta = [hints?.officeCode || escape(data.officeCode?.trim() ?? ''), hints?.date || escape(data.date?.trim() ?? '')].filter(Boolean);
  const top = meta.length ? '\\noindent\\begin{tabularx}{\\textwidth}{@{}Xr@{}}\n' + meta.map(value => ' & ' + value + ' \\\\').join('\n')
    + '\n\\end{tabularx}\n\n' : '';
  const heading = top + center(decision ? 'POSITION/DECISION PAPER' : 'INFORMATION PAPER') + line('Subject:', data.subject?.toUpperCase(), hints?.subject);
  const attribution = line('Prepared by:', data.preparedBy, hints?.preparedBy) + (decision ? line('Approved by:', data.staffApprovedBy) : '');
  let closing = '\\par\\vspace{12pt}\n\n' + attribution;
  if (!decision) return { heading, body: '', closing };
  closing += '\\vspace{12pt}\n\n';

  const writeIn = escape('__________');
  const options = staffDecisionOptions(data);
  const officials = staffDecisionOfficials(data);
  const grid = (choices: string[] = []) => officials.map((official, index) => {
    const final = index === officials.length - 1;
    const role = escape(official) + (final ? ' decision:' : ' recommends:');
    const responses = choices.length ? choices : final ? ['Approved', 'Disapproved'] : ['Approval', 'Disapproval'];
    const rows = responses.map((response, row) => (row === 0 ? role : '') + ' & ' + response + ' ' + writeIn + ' \\\\').join('\n');
    return '\\noindent\\begin{tabularx}{\\textwidth}{@{}Xr@{}}\n' + rows + '\n\\end{tabularx}\n\n\\vspace{8pt}\n\n';
  }).join('');
  switch (data.staffDecisionStyle) {
    case 'choose_one':
      closing += options.map((value, index) => line('COA ' + (index + 1) + ':', value)).join('')
        + grid(options.map((_, index) => 'COA ' + (index + 1)));
      break;
    case 'independent':
      closing += options.map((value, index) => line('Recommendation ' + (index + 1) + ':', value) + grid()).join('');
      break;
    default:
      closing += grid();
  }
  return { heading, body: '', closing };
}
