/**
 * What each MCP tool returns, as a schema.
 *
 * `letterSchema.ts` holds the request shape; this holds the four result
 * shapes. Clients validate `structuredContent` against them.
 */
import * as z from 'zod';
import type { LetterTemplate } from '../src/data/templates/types';
import { unit } from './letterSchema';

export const renderResult = z.object({
  format: z.enum(['pdf', 'docx']),
  path: z.string().describe('Absolute path of the written file.'),
  bytes: z.number().int().nonnegative(),
});

export const templateSummary = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
});

export const templateListResult = z.object({ templates: z.array(templateSummary) });

// A field added to LetterTemplate is a compile error here.
export const templateResult = templateSummary.extend({
  docType: z.string(),
  subject: z.string(),
  paragraphs: z.array(z.object({ text: z.string(), level: z.number().int() })),
  references: z.array(z.object({ letter: z.string(), title: z.string(), url: z.string().optional() })).optional(),
  ssic: z.string().optional(),
}) satisfies z.ZodType<LetterTemplate>;

// A match's `unit` is a subset of the `unit` dondocs_letter accepts.
export const unitLookupResult = z.object({
  source: z.string(),
  lastUpdated: z.string(),
  total: z.number().int().nonnegative().describe('Matches before `limit` was applied.'),
  truncated: z.boolean(),
  matches: z.array(z.object({
    mcc: z.string().nullable(),
    unit: unit.pick({ name: true, line2: true, address: true, department: true }),
  })),
});
