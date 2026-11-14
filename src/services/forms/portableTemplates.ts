import { z } from 'zod';
import { compileFormDefinition, type FormDefinition } from './model';
import { loadPackagePage, retainPackagePages, validatePackagePage } from './packages';
import { buildPortableResources, parsePortableResources, portableResourceDigest, MAX_PORTABLE_RESOURCE_BYTES, MAX_PORTABLE_TOTAL_BYTES, MAX_PORTABLE_RESOURCE_COUNT, type PortableResourceInput, type PortableResourceManifest } from '@/lib/portableResources';

const bindingSchema = z.object({
  kind: z.literal('dondocs-form-templates'), version: z.literal(1),
  definitionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.record(z.string(), z.string().regex(/^forms\/[a-f0-9]{64}\.pdf$/))
    .refine(pages => Object.keys(pages).length > 0 && Object.keys(pages).length <= MAX_PORTABLE_RESOURCE_COUNT, 'Too many or missing form template pages'),
}).strict();
const bindingsSchema = z.array(bindingSchema).min(1).max(256);
export type PortableFormTemplateBinding = z.infer<typeof bindingSchema>;
export interface PortableFormTemplateBundle {
  portableFormTemplates: PortableFormTemplateBinding[];
  portableResources: PortableResourceManifest;
}
export interface PreparedPortableFormTemplates { definition: FormDefinition; pages: Record<string, Uint8Array> }

export function formTemplateResourcePaths(value: unknown): string[] {
  return [...new Set(bindingsSchema.parse(value).flatMap(binding => Object.values(binding.pages)))];
}

async function definitionDigest(definition: FormDefinition): Promise<string> {
  return portableResourceDigest(new TextEncoder().encode(JSON.stringify(compileFormDefinition(definition))).buffer);
}

/** Capture each exact page once across all retained document/form revisions. */
export async function capturePortableFormTemplates(definitions: readonly FormDefinition[]): Promise<PortableFormTemplateBundle | undefined> {
  if (!definitions.length) return undefined;
  if (definitions.length > 256) throw new Error('Too many portable form definitions.');
  const bindings = new Map<string, PortableFormTemplateBinding>();
  const resources = new Map<string, PortableResourceInput>();
  let total = 0;
  for (const source of definitions) {
    const definition = compileFormDefinition(source);
    if (definition.pages.length > MAX_PORTABLE_RESOURCE_COUNT) throw new Error('Too many portable form template pages.');
    const definitionSha256 = await definitionDigest(definition);
    if (bindings.has(definitionSha256)) continue;
    const pages: Record<string, string> = {};
    for (const page of definition.pages) {
      if (!page.sha256) throw new Error(`Template page has no checksum: ${page.file}`);
      const path = `forms/${page.sha256}.pdf`;
      if (!resources.has(path)) {
        if (resources.size >= MAX_PORTABLE_RESOURCE_COUNT) throw new Error('Too many portable form template pages.');
        const data = new Uint8Array(await loadPackagePage(definition, page.file));
        if (data.byteLength > MAX_PORTABLE_RESOURCE_BYTES) throw new Error('A portable form template exceeds the 25 MB file limit.');
        total += data.byteLength;
        if (total > MAX_PORTABLE_TOTAL_BYTES) throw new Error('Portable form templates exceed the 75 MB total limit.');
        resources.set(path, { path, name: page.file, mediaType: 'application/pdf', data: data.buffer });
      }
      pages[page.file] = path;
    }
    bindings.set(definitionSha256, { kind: 'dondocs-form-templates', version: 1, definitionSha256, pages });
  }
  return { portableFormTemplates: [...bindings.values()], portableResources: await buildPortableResources([...resources.values()]) };
}

/** Validate the full inventory, definitions, digests and PDF geometry before any
 * cache write or editor/library transition. No local handles or form IDs confer
 * authority over a different installed definition. */
export async function validatePortableFormTemplates(definitions: readonly FormDefinition[], bindingsValue: unknown, resourcesValue: unknown): Promise<PreparedPortableFormTemplates[]> {
  const bindings = bindingsSchema.parse(bindingsValue);
  const resources = await parsePortableResources(resourcesValue);
  const expected = new Map<string, FormDefinition>();
  for (const source of definitions) {
    const definition = compileFormDefinition(source);
    expected.set(await definitionDigest(definition), definition);
  }
  const used = new Set<string>();
  const found = new Set<string>();
  const prepared: PreparedPortableFormTemplates[] = [];
  for (const binding of bindings) {
    const definition = expected.get(binding.definitionSha256);
    if (!definition || found.has(binding.definitionSha256)) throw new Error('Portable templates do not match the saved form definition.');
    found.add(binding.definitionSha256);
    if (Object.keys(binding.pages).length !== definition.pages.length) throw new Error('The portable form has missing or unexpected template pages.');
    const pages: Record<string, Uint8Array> = {};
    for (const page of definition.pages) {
      const path = binding.pages[page.file];
      const resource = resources.get(path);
      if (!page.sha256 || path !== `forms/${page.sha256}.pdf` || !resource || resource.mediaType !== 'application/pdf') throw new Error(`Portable form template missing or mismatched: ${page.file}`);
      const bytes = new Uint8Array(resource.data);
      await validatePackagePage(definition, page.file, bytes);
      pages[page.file] = bytes;
      used.add(path);
    }
    prepared.push({ definition, pages });
  }
  if (found.size !== expected.size || used.size !== resources.size) throw new Error('The portable form resource inventory is incomplete or contains unexpected files.');
  return prepared;
}

/** The caller publishes its saved document/package only after this succeeds. */
export async function retainPortableFormTemplates(prepared: readonly PreparedPortableFormTemplates[], current: () => boolean = () => true): Promise<boolean> {
  for (const form of prepared) if (!await retainPackagePages(form.definition, form.pages, current)) return false;
  return current();
}
