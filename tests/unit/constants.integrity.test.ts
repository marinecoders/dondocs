/**
 * Integrity tests for `src/lib/constants.ts`.
 *
 * The constants tables (placeholder lists, doc-type configs, classification
 * map, etc.) are dictionaries that get cross-referenced from many places.
 * A subtle bug — duplicate keys, mismatched shape, broken cross-references
 * — can silently break a feature without crashing anything. These tests
 * pin down the table-level invariants that are easy to break and hard
 * to notice.
 */
import { describe, it, expect } from 'vitest';
import {
  PARAGRAPH,
  CLASSIFICATION,
  DOC_TYPES,
  FILE_LIMITS,
  FILE_TYPES,
  ERROR_CODES,
  STORAGE_KEYS,
  APP_INFO,
  BATCH_PLACEHOLDERS,
  NAVMC_10274_PLACEHOLDERS,
  NAVMC_118_11_PLACEHOLDERS,
} from '@/lib/constants';

describe('PARAGRAPH constants', () => {
  it('MAX_DEPTH is a sensible bound (≥ 4 for SECNAV levels 1-4)', () => {
    expect(PARAGRAPH.MAX_DEPTH).toBeGreaterThanOrEqual(4);
  });
});

describe('CLASSIFICATION constants', () => {
  it('contains the standard DoD levels', () => {
    expect(CLASSIFICATION).toHaveProperty('UNCLASSIFIED');
    expect(CLASSIFICATION).toHaveProperty('CONFIDENTIAL');
    expect(CLASSIFICATION).toHaveProperty('SECRET');
    expect(CLASSIFICATION).toHaveProperty('TOP_SECRET');
  });

  it('every entry has the expected shape (label, color, textColor, bannerText)', () => {
    for (const [key, value] of Object.entries(CLASSIFICATION)) {
      const v = value as { label?: string; color?: string; textColor?: string; bannerText?: string };
      expect(v, `${key}.label`).toHaveProperty('label');
      expect(v, `${key}.color`).toHaveProperty('color');
      expect(v, `${key}.textColor`).toHaveProperty('textColor');
      expect(v, `${key}.bannerText`).toHaveProperty('bannerText');
      expect(typeof v.label).toBe('string');
      expect((v.label ?? '').length).toBeGreaterThan(0);
    }
  });

  it('bannerText is uppercase (per CAPCO marking conventions)', () => {
    for (const [key, value] of Object.entries(CLASSIFICATION)) {
      const v = value as { bannerText: string };
      expect(v.bannerText, `${key}.bannerText`).toBe(v.bannerText.toUpperCase());
    }
  });
});

describe('DOC_TYPES constants', () => {
  it('contains naval_letter (the default doc type)', () => {
    expect(DOC_TYPES).toHaveProperty('naval_letter');
  });

  it('every entry has a non-empty value', () => {
    for (const [key, value] of Object.entries(DOC_TYPES)) {
      expect(value, `${key} should be truthy`).toBeTruthy();
    }
  });
});

describe('FILE_LIMITS', () => {
  it('every limit is a positive number', () => {
    for (const [key, value] of Object.entries(FILE_LIMITS)) {
      expect(typeof value, `${key} should be a number`).toBe('number');
      expect(value as number, `${key} should be positive`).toBeGreaterThan(0);
    }
  });
});

describe('FILE_TYPES', () => {
  it('exposes the set of MIME-type buckets the upload UIs depend on', () => {
    // Concrete keys: each upload component switches on these names; if a
    // key disappears the rest of the codebase breaks at use-sites without
    // a unit test catching it. Pinning the keys here is the regression
    // gate. (Original test only checked `typeof === 'object'`, which
    // passed for `{}` — useless.)
    expect(FILE_TYPES).toHaveProperty('PDF');
    expect(FILE_TYPES).toHaveProperty('IMAGE');
    expect(FILE_TYPES).toHaveProperty('EXCEL');
    expect(FILE_TYPES).toHaveProperty('JSON');
  });

  it('every bucket is a non-empty array of MIME-type strings', () => {
    // Catches a regression that empties a bucket (e.g. removes
    // `application/pdf` from the PDF list) — that would silently break
    // PDF uploads everywhere without any other test failing.
    for (const [bucket, mimes] of Object.entries(FILE_TYPES)) {
      expect(Array.isArray(mimes), `${bucket} should be an array`).toBe(true);
      expect((mimes as readonly string[]).length, `${bucket} must have at least one MIME type`).toBeGreaterThan(0);
      for (const mime of mimes as readonly string[]) {
        // MIME type shape: `type/subtype` — at minimum one slash
        expect(mime, `${bucket} entry`).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/i);
      }
    }
  });

  it('PDF bucket includes application/pdf (depended on by the enclosure-upload + signature flows)', () => {
    expect(FILE_TYPES.PDF).toContain('application/pdf');
  });
});

describe('ERROR_CODES', () => {
  it('every code is a non-empty string', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(typeof value, `${key} should be a string`).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('all codes are unique', () => {
    const values = Object.values(ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('STORAGE_KEYS', () => {
  it('all keys are unique strings (no two features writing to the same key)', () => {
    const values = Object.values(STORAGE_KEYS).filter((v) => typeof v === 'string');
    expect(new Set(values).size).toBe(values.length);
  });

  it('all keys are namespaced under "dondocs" (case-insensitive)', () => {
    // Conventional prefix prevents key collisions with other apps on
    // the same origin — important since localStorage is unscoped.
    // The DEBUG key uses the historical uppercase form (DONDOCS_DEBUG),
    // others use the lowercase kebab form (dondocs-*); both contain
    // "dondocs".
    for (const [key, value] of Object.entries(STORAGE_KEYS)) {
      if (typeof value === 'string') {
        expect(value.toLowerCase(), `${key} should namespace under "dondocs"`).toMatch(
          /dondocs/
        );
      }
    }
  });
});

describe('APP_INFO', () => {
  it('has a non-empty name', () => {
    expect(typeof APP_INFO.NAME).toBe('string');
    expect((APP_INFO.NAME as string).length).toBeGreaterThan(0);
  });
});

describe('BATCH_PLACEHOLDERS', () => {
  it('every entry has all required fields (name, label, category, example)', () => {
    for (const p of BATCH_PLACEHOLDERS) {
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('label');
      expect(p).toHaveProperty('category');
      expect(p).toHaveProperty('example');
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('placeholder names are unique (a duplicate name silently shadows a real placeholder)', () => {
    const names = BATCH_PLACEHOLDERS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('placeholder names are uppercase ASCII (the regex contract assumed by detectPlaceholders + escapeLatex)', () => {
    for (const p of BATCH_PLACEHOLDERS) {
      expect(p.name, `${p.name} should be ALL_CAPS`).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});

describe('NAVMC_10274_PLACEHOLDERS', () => {
  it('every entry has the expected shape', () => {
    for (const p of NAVMC_10274_PLACEHOLDERS) {
      expect(p).toHaveProperty('name');
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('names are unique', () => {
    const names = NAVMC_10274_PLACEHOLDERS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names match the placeholder regex contract', () => {
    for (const p of NAVMC_10274_PLACEHOLDERS) {
      expect(p.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});

describe('NAVMC_118_11_PLACEHOLDERS', () => {
  it('every entry has the expected shape', () => {
    for (const p of NAVMC_118_11_PLACEHOLDERS) {
      expect(p).toHaveProperty('name');
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('names are unique', () => {
    const names = NAVMC_118_11_PLACEHOLDERS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names match the placeholder regex contract', () => {
    for (const p of NAVMC_118_11_PLACEHOLDERS) {
      expect(p.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
