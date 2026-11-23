import type { DocumentData } from '@/types/document';
import type { BodyTable } from './bodyTable';
import { unfilled } from './requiredField';

export const STAFF_PAPER_TYPES = ['position_decision_paper', 'information_paper', 'coordination_page'] as const;

export function isStaffPaper(type: string): type is typeof STAFF_PAPER_TYPES[number] {
  return STAFF_PAPER_TYPES.some(paper => paper === type);
}

function coordinationRows(data: Partial<DocumentData>): string[][] {
  const hqmc = data.coordinationLayout === 'hqmc';
  return (data.coordinationEntries ?? []).map(entry => hqmc
    ? [entry.office, entry.contact, [entry.date, entry.position].map(value => value.trim()).filter(Boolean).join('; ')]
    : [entry.office, entry.contact, entry.phone, entry.date, entry.position])
    .filter(row => row.some(value => value.trim()));
}

export function coordinationTable(data: Partial<DocumentData>): BodyTable {
  const hqmc = data.coordinationLayout === 'hqmc';
  const header = hqmc ? ['STAFF/EXTERNAL AGENCY', 'NAME', 'DATE & POSITION']
    : ['Office/Dept', 'Point of Contact/Title', 'Phone', 'Date', 'Remarks'];
  return {
    rows: [header, ...coordinationRows(data)],
    headerRows: 1,
    columnWidths: hqmc ? [38, 25, 37] : [19, 29, 19, 17, 16],
    repeatHeaders: true,
    borders: 'none',
  };
}

export function staffDecisionOptions(data: Partial<DocumentData>): string[] {
  return (data.staffDecisionOptions ?? '').split('\n').map(value => value.trim()).filter(Boolean);
}

export function staffDecisionOfficials(data: Partial<DocumentData>): string[] {
  const fallback = data.staffDecisionStyle === 'independent'
    ? 'SMMC\nDMCS\nACMC\nCMC' : 'Dir Ops\nADC PP&O\nDC PP&O\nDMCS\nACMC\nCMC';
  return (data.staffDecisionOfficials ?? fallback).split('\n').map(value => value.trim()).filter(Boolean);
}

export function staffPaperIssues(docType: string, data: Partial<DocumentData>): string[] {
  if (!isStaffPaper(docType)) return [];
  if (docType === 'coordination_page') {
    const rows = coordinationRows(data);
    const issues: string[] = [];
    if (data.coordinationLayout === 'hqmc' && unfilled(data.subject)) issues.push('Enter the HQMC coordination subject.');
    if (!rows.length) issues.push('Add at least one coordinating office.');
    if (rows.some(row => unfilled(row[0]))) issues.push('Enter an office name for each populated coordination row.');
    return issues;
  }
  const issues: string[] = [];
  if ([data.officeCode, data.date, data.subject, data.preparedBy].some(unfilled)) {
    issues.push('Complete the office code, date, subject and prepared-by fields.');
  }
  if (docType === 'position_decision_paper') {
    const officials = staffDecisionOfficials(data);
    if (!officials.length || officials.some(unfilled)) issues.push('Enter the officials in routing order, with the decision authority last.');
    if (officials.length > 12) issues.push('Use up to 12 officials in the decision grid.');
    const options = staffDecisionOptions(data);
    if (data.staffDecisionStyle && data.staffDecisionStyle !== 'single' && options.length < 2) {
      issues.push('Enter at least two choices or recommendations for this decision grid.');
    }
    if (data.staffDecisionStyle && data.staffDecisionStyle !== 'single' && options.length > 12) {
      issues.push('Use up to 12 choices or recommendations in the decision grid.');
    }
  }
  return issues;
}
