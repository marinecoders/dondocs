import editions from '@/data/officialPdfEditions.json' with { type: 'json' };

export const officialFormChoices = Array.from(new Map(editions.filter(profile => profile.formId !== 'package_correspondence').map(profile => [profile.formId, profile.label])), ([id, label]) => ({ id, label }));

// Hybrid editions expose the same named widgets and also maintain XFA datasets.
export function hasNativeWidgets(format?: string) {
  return format === 'acroform' || format === 'hybrid';
}

export function officialEdition(formId: string, edition?: string) {
  return editions.find(profile => profile.formId === formId && (edition === undefined || profile.edition === edition));
}

/** Acrobat and DonDocs incremental revisions retain the exact publisher PDF as a prefix. */
export async function identifyOfficialOriginal(data: ArrayBuffer) {
  const { portableResourceDigest } = await import('@/lib/portableResources');
  for (const source of editions) {
    if (data.byteLength >= source.length && await portableResourceDigest(data.slice(0, source.length)) === source.sha256) return source.formId;
  }
}

export function nativeSigningFormId<T>(category: unknown, formType: T) {
  return category === 'correspondence' ? 'package_correspondence' : formType;
}
