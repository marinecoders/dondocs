// Schema dependency frozen from main ff57278f1ae08bf78e2a1e68e428c2919d8e0999 (1.3.37).
// Keep the historical codec independent of current paragraph refinements.
import { z } from 'zod';
import { DOC_TYPE_LABELS } from '@/types/document';

const signature = z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).optional() });
const form = z.record(z.string(), z.union([z.string(), z.array(signature)]));
export const sessionSchema = z.object({
  documentMode: z.enum(['compliant', 'custom']),
  documentCategory: z.enum(['correspondence', 'forms']).default('correspondence'),
  docType: z.string().refine((v) => Object.hasOwn(DOC_TYPE_LABELS, v)),
  formType: z.string().default('navmc_10274'),
  genericForm: z.unknown().optional(),
  formData: z.record(z.string(), z.unknown()),
  paragraphs: z.array(z.object({ text: z.string(), level: z.number().int().min(0).max(10), header: z.string().optional(), portionMarking: z.string().optional(),
    tableKey: z.string().optional(), tableIdentifierMode: z.enum(['stock', 'software']).optional(), callout: z.enum(['warning', 'caution', 'note']).optional(), procedure: z.boolean().optional(), appendix: z.boolean().optional(),
    referenceId: z.string().optional(), publicationSection: z.string().optional(), tableFootnotes: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    figure: z.object({ name: z.string().optional(), type: z.string().optional(), width: z.number().optional(), height: z.number().optional(), portionMarking: z.string().optional() }).optional(),
  })),
  references: z.array(z.object({ letter: z.string(), title: z.string(), url: z.string().optional() })),
  enclosures: z.array(z.object({ title: z.string(), pageStyle: z.string().optional(), hasCoverPage: z.boolean().optional(), coverPageDescription: z.string().optional() })),
  copyTos: z.array(z.object({ text: z.string() })),
  endItems: z.array(z.object({ nsn: z.string(), tamcn: z.string(), id: z.string(), model: z.string() })).default([]),
  publicationTables: z.record(z.string(), z.array(z.object({ values: z.record(z.string(), z.string()), level: z.number().optional(), identificationException: z.string().optional(), openPurchase: z.object({ manufacturer: z.string(), address: z.string() }).optional() }))).default({}),
  distributions: z.array(z.object({ text: z.string() })).default([]),
  forms: z.object({ navmc10274: form.optional(), navmc11811: form.optional(), includeCoverPage: z.boolean().default(true) }).optional(),
  timestamp: z.number().default(0),
});
