import { portableResourceDigest } from '@/lib/portableResources';
import type { FormSession } from '@/stores/formStore';
import { loadTemplatePage, readRetainedTemplatePage } from '@/services/pdf/loadTemplatePage';

export interface OfficialPdfProfile {
  readonly formId: string;
  readonly edition: string;
  readonly label: string;
  readonly source: string;
  readonly sha256: string;
  readonly fill: (answers: FormSession, original: ArrayBuffer) => Promise<Uint8Array<ArrayBuffer>>;
}

export const PAGE11_PRINTABLE_SHA256 = 'eaea7e582dc90ab4bffc88b5ff28b5795b0432206dda005ee2e912ff6a0401fb';
export const PAGE11_OFFICIAL_SHA256 = '84f309e0e02eff1977d22875a9cf48574c64ee43e83499640848d5470c9a4bed';

// Keep old profiles addressable by edition when a new one becomes the default.
const profiles: readonly OfficialPdfProfile[] = [{
  formId: 'navmc_118_11',
  edition: '2014-05',
  label: 'Page 11',
  source: 'NAVMC11811 - Administrative Remarks/2014-05/original.pdf',
  sha256: PAGE11_OFFICIAL_SHA256,
  async fill(answers, original) {
    if (!answers.navmc11811) throw new Error('The Page 11 draft is missing.');
    const { generateOfficialPage11Pdf } = await import('@/services/pdf/navmc11811Native');
    return generateOfficialPage11Pdf(answers.navmc11811, original, ['', '', '']);
  },
}];

export function officialPdfProfile(formId: string, edition?: string): OfficialPdfProfile | undefined {
  const profile = profiles.find(profile => profile.formId === formId
    && (edition === undefined || profile.edition === edition));
  if (!profile && edition !== undefined) throw new Error('The pinned official PDF edition is unavailable.');
  return profile;
}

export const officialPdfForms = Array.from(new Map(profiles.map(profile => [profile.formId, profile.label])), ([id, label]) => ({ id, label }));

export async function checkOfficialPdfSource(profile: OfficialPdfProfile, original: ArrayBuffer): Promise<void> {
  if (await portableResourceDigest(original) !== profile.sha256) {
    throw new Error(`The official PDF does not match the pinned ${profile.label} edition.`);
  }
}

export async function loadOfficialPdfSource(profile: OfficialPdfProfile): Promise<ArrayBuffer> {
  const retained = await readRetainedTemplatePage(profile.sha256);
  if (retained) return retained;
  const original = await loadTemplatePage(`${import.meta.env.BASE_URL}templates/${profile.source}`);
  await checkOfficialPdfSource(profile, original);
  return original;
}

export async function fillOfficialPdf(profile: OfficialPdfProfile, answers: FormSession, original: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  await checkOfficialPdfSource(profile, original);
  return profile.fill(answers, original);
}
