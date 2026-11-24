import { CUI_COALITION_CODES, CUI_COUNTRY_CODES, CUI_PROVISIONAL_CATEGORIES, CUI_REGISTRY_CATEGORIES, CUI_SPECIFIED_CODES } from '@/data/cuiRegistry';

export const CUI_CATEGORY_REGISTRY = 'https://www.archives.gov/cui/registry/category-marking-list';
export const CUI_DISSEMINATION_REGISTRY = 'https://www.archives.gov/cui/registry/limited-dissemination';

export const CUI_FIXED_CONTROLS = ['NOFORN', 'FED ONLY', 'FEDCON', 'NOCON', 'DL ONLY', 'RELIDO', 'Attorney-Client', 'Attorney-WP'];
const fixed = new Map(CUI_FIXED_CONTROLS.map(mark => [mark.toUpperCase(), mark]));
const categories = new Map<string, string>();
for (const [code, name] of CUI_REGISTRY_CATEGORIES) {
  categories.set(code, code);
  categories.set(name.toUpperCase(), code);
}
for (const code of CUI_SPECIFIED_CODES) categories.set('SP-' + code, 'SP-' + code);
for (const name of CUI_PROVISIONAL_CATEGORIES) categories.set(name.toUpperCase(), name);

function markingList(value: string, delimiter: RegExp): string[] {
  return value.split(delimiter).map(mark => mark.trim().toUpperCase().replace(/\s+/g, ' ')).filter(Boolean);
}

function categoryMarks(value: string): string[] | undefined {
  const marks = markingList(value, /[,;\r\n]/).flatMap(mark => categories.has(mark) ? [mark] : markingList(mark, /\//));
  if (value.trim() && !marks.length) return;
  const resolved = new Set<string>();
  for (const mark of marks) {
    const entry = categories.get(mark);
    if (!entry) return;
    resolved.add(entry);
  }
  return [...resolved];
}

const countries = new Set(CUI_COUNTRY_CODES);
const coalitions = new Set(CUI_COALITION_CODES);

function parseControlGroup(group: string): string[] | undefined {
  const tokens = markingList(group, /,/);
  const marks: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const mark = tokens[i];
    const control = fixed.get(mark);
    if (control) {
      marks.push(control);
      continue;
    }
    if (mark !== 'REL TO USA' && mark !== 'DISPLAY ONLY USA') return;
    const countryList: string[] = [];
    const coalitionList: string[] = [];
    // The comma can separate a recipient within a marking or the next control.
    while (i + 1 < tokens.length) {
      const next = tokens[i + 1];
      if (next === 'USA') return;
      if (countries.has(next)) countryList.push(next);
      else if (coalitions.has(next)) coalitionList.push(next);
      else break;
      i++;
    }
    const recipients = [...new Set(countryList.sort()), ...new Set(coalitionList.sort())];
    if (!recipients.length) return;
    marks.push([mark, ...recipients].join(', '));
  }
  return marks;
}

function disseminationMarks(value: string): string[] | undefined {
  const marks = new Set<string>();
  for (const group of value.split(/[;/\r\n]/)) {
    const parsed = parseControlGroup(group);
    if (!parsed) return;
    for (const mark of parsed) marks.add(mark);
  }
  return !value.trim() || marks.size ? [...marks] : undefined;
}

type CuiMarkingFields = { cuiCategory?: string; cuiDissemination?: string };
export interface CuiRegistryIssue {
  field: keyof CuiMarkingFields;
  message: string;
}

/** Recognize designation-block text. The originator determines applicability. */
export function inspectCuiRegistryMarkings({ cuiCategory, cuiDissemination }: CuiMarkingFields) {
  const foundCategories = cuiCategory === undefined ? [] : typeof cuiCategory === 'string' ? categoryMarks(cuiCategory) : undefined;
  const foundControls = cuiDissemination === undefined ? [] : typeof cuiDissemination === 'string' ? disseminationMarks(cuiDissemination) : undefined;
  const issues: CuiRegistryIssue[] = [];
  if (!foundCategories) issues.push({
    field: 'cuiCategory',
    message: 'Review CUI categories. Enter each approved registry category name or marking.',
  });
  if (!foundControls) issues.push({
    field: 'cuiDissemination',
    message: 'Review CUI dissemination controls. Use approved registry markings and include the authorized recipients with REL TO or DISPLAY ONLY.',
  });
  if (foundCategories && !foundCategories.includes('PRIVILEGE') && foundControls?.some(mark => mark.startsWith('Attorney-'))) issues.push({
    field: 'cuiDissemination',
    message: 'Attorney-Client and Attorney-WP controls require the Legal Privilege CUI category.',
  });
  return {
    issues,
    categories: foundCategories,
    controls: foundControls,
  };
}

/** Canonicalize only the output copy. Existing draft values stay editable. */
export function normalizeCuiRegistryMarkings<T extends CuiMarkingFields>(data: T): T {
  const { issues, categories, controls } = inspectCuiRegistryMarkings(data);
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(' '));
  return {
    ...data,
    ...(data.cuiCategory !== undefined ? { cuiCategory: categories?.join(', ') } : {}),
    ...(data.cuiDissemination !== undefined ? { cuiDissemination: controls?.join('/') } : {}),
  };
}
