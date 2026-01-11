// Office Codes Database
// Source: navalletterformat

import officeCodesData from './office-codes.json';

export interface OfficeCode {
  code: string;
  title: string;
  category: string;
  description: string;
}

export interface OfficeCodeCategory {
  name: string;
  codes: OfficeCode[];
}

// Export raw data
export const OFFICE_CODES: OfficeCode[] = officeCodesData.codes;
export const OFFICE_CODE_CATEGORIES: string[] = officeCodesData.categories;

// Group codes by category
export function getOfficeCodesByCategory(): OfficeCodeCategory[] {
  const categoryMap = new Map<string, OfficeCode[]>();

  // Initialize categories in order
  OFFICE_CODE_CATEGORIES.forEach(cat => {
    categoryMap.set(cat, []);
  });

  // Group codes
  OFFICE_CODES.forEach(code => {
    const category = categoryMap.get(code.category);
    if (category) {
      category.push(code);
    }
  });

  // Convert to array
  return OFFICE_CODE_CATEGORIES.map(name => ({
    name,
    codes: categoryMap.get(name) || []
  })).filter(cat => cat.codes.length > 0);
}

// Search office codes
export function searchOfficeCodes(query: string): OfficeCode[] {
  const q = query.toLowerCase().trim();
  if (!q) return OFFICE_CODES;

  return OFFICE_CODES.filter(code =>
    code.code.toLowerCase().includes(q) ||
    code.title.toLowerCase().includes(q) ||
    code.description.toLowerCase().includes(q)
  );
}

// Get code by code string
export function getOfficeCode(code: string): OfficeCode | undefined {
  return OFFICE_CODES.find(c => c.code === code);
}

// Export metadata
export const OFFICE_CODES_INFO = {
  totalCodes: OFFICE_CODES.length,
  categories: OFFICE_CODE_CATEGORIES.length,
  source: 'navalletterformat',
  lastUpdated: '2026-01-05'
};
