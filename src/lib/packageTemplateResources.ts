import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { portableResourceDigest } from './portableResources';
import type { PackageAsset } from './actionPackages';
import { templateSourceAssets, type CapturedTemplateSource } from './packageConditionalState';
import { packageTemplateV2Schema, type PackageTemplateV2 } from './packageTemplateSchema';
import { MAX_PACKAGE_TEMPLATE_BYTES, validatePackageTemplate } from './packageTemplateLibrary';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer;

export async function captureTemplateSource(template: PackageTemplateV2,
  stage: (name: string, type: string, data: ArrayBuffer) => Promise<PackageAsset>): Promise<CapturedTemplateSource> {
  const compact = structuredClone(template);
  const pdfs = new Map<string, NonNullable<CapturedTemplateSource['resources']>['pdfs'][number]>();
  for (const member of compact.members) {
    if (member.kind !== 'native') continue;
    for (const page of Object.values(member.pages)) {
      const bytes = new Uint8Array(base64ToUint8Array(page.data)).buffer;
      const digest = await portableResourceDigest(bytes);
      if (!pdfs.has(digest)) pdfs.set(digest, { ...await stage(page.name, page.type, bytes), type: 'application/pdf' });
      page.data = digest;
    }
  }
  const source = await stage(template.name + '.dondocs-template.json', 'application/json', encode(compact));
  return { ...source, type: 'application/json', ...(pdfs.size > 0 && {
    resources: { templateSha256: await portableResourceDigest(encode(template)), pdfs: [...pdfs.values()] },
  }) };
}

export async function restoreTemplateSource(source: CapturedTemplateSource, read: (asset: PackageAsset) => Promise<ArrayBuffer>) {
  const [descriptor] = templateSourceAssets(source);
  const bytes = await read(descriptor);
  if (bytes.byteLength !== source.size || await portableResourceDigest(bytes) !== source.sha256)
    throw new Error('The captured action template is missing or corrupt.');
  const compact = packageTemplateV2Schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (source.resources) {
    const files = new Map(source.resources.pdfs.map(asset => [asset.sha256, asset]));
    const encoded = new Map<string, string>();
    let size = bytes.byteLength;
    for (const member of compact.members) {
      if (member.kind !== 'native') continue;
      for (const page of Object.values(member.pages)) {
        const asset = files.get(page.data);
        if (!asset) throw new Error('A captured template PDF is missing.');
        size += 4 * Math.ceil(asset.size / 3) - page.data.length;
        if (size > MAX_PACKAGE_TEMPLATE_BYTES) throw new Error('The expanded template exceeds its supported size.');
        if (!encoded.has(asset.sha256)) {
          const data = await read(asset);
          if (data.byteLength !== asset.size || await portableResourceDigest(data) !== asset.sha256)
            throw new Error('A captured template PDF failed its checksum.');
          encoded.set(asset.sha256, uint8ArrayToBase64(new Uint8Array(data)));
        }
        page.data = encoded.get(asset.sha256)!;
      }
    }
    if (encoded.size !== source.resources.pdfs.length || await portableResourceDigest(encode(compact)) !== source.resources.templateSha256)
      throw new Error('The restored template does not match its captured edition.');
  }
  const template = await validatePackageTemplate(compact);
  if (template.version !== 2) throw new Error('This action requires its exact versioned template.');
  return template;
}
