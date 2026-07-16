// SSIC (Standard Subject Identification Code) reference data.
//
// Codes come from `ssic.json` (SECNAV M-5210.2, August 2018 — 2,240 codes).
// That file is the source of truth for code + title; this module only groups
// them and layers on the hand-written descriptions.
//
// Loaded through a cached dynamic import() so the 172 KB payload stays out of
// the main bundle — the same treatment units.json gets. Callers await
// `loadSsicCategories()`; the SSIC lookup modal does so when it opens.

export interface SSICCode {
  code: string;
  title: string;
  description?: string;
}

export interface SSICCategory {
  range: string;
  name: string;
  codes: SSICCode[];
}

/**
 * SSIC major groups, keyed by the thousands digit of the code.
 *
 * Groups 1000–13000 are the SECNAV M-5210.2 subject groups. Each name was
 * cross-checked against the codes actually filed under it in ssic.json — 10000
 * holds "Provisions and Rations" / "Clothing and Uniforms" (General Material)
 * while 11000 holds "Shore Station Development" / "Real Estate" (Facilities
 * and Activities).
 *
 * 14000–16000 are NOT M-5210.2 subject groups. Those 20 codes exist in the
 * source data and name themselves in their own group code ("SHIPS (GENERAL)",
 * "COMBAT SERVICE SUPPORT (GENERAL)", "CIVIL AFFAIRS (GENERAL)"), so they're
 * surfaced under those titles rather than dropped or filed under a guess.
 */
const SSIC_GROUPS: { thousand: number; name: string }[] = [
  { thousand: 1, name: 'Military Personnel' },
  { thousand: 2, name: 'Telecommunications' },
  { thousand: 3, name: 'Operations and Readiness' },
  { thousand: 4, name: 'Logistics' },
  { thousand: 5, name: 'General Administration and Management' },
  { thousand: 6, name: 'Medicine and Dentistry' },
  { thousand: 7, name: 'Financial Management' },
  { thousand: 8, name: 'Ordnance Material' },
  { thousand: 9, name: 'Ships Design and Material' },
  { thousand: 10, name: 'General Material' },
  { thousand: 11, name: 'Facilities and Activities' },
  { thousand: 12, name: 'Civilian Personnel' },
  { thousand: 13, name: 'Aeronautical and Astronautical Material' },
  { thousand: 14, name: 'Ships' },
  { thousand: 15, name: 'Combat Service Support' },
  { thousand: 16, name: 'Civil Affairs' },
];

/**
 * Plain-language descriptions for the codes reached for most often.
 * Supplementary only — the title from ssic.json is the authoritative text.
 */
const CODE_DESCRIPTIONS: Record<string, string> = {
  '1000': 'General matters relating to military personnel',
  '1500': 'Military education and professional development',
  '3000': 'Operational planning and readiness matters',
  '4000': 'Supply, maintenance, and logistics support',
  '5000': 'Administrative policy and procedures',
  '5210': 'Filing systems, records retention and disposition',
  '5216': 'Official correspondence and memoranda',
  '6000': 'Medical and dental services',
  '7000': 'Budgeting, accounting, and fiscal matters',
  '8000': 'Weapons and ammunition',
  '9000': 'Vessels and aviation systems',
};

/**
 * Codes carried over from the previous hand-maintained list that ssic.json
 * doesn't contain, so widening the dataset can't silently drop a code someone
 * already relies on.
 */
const EXTRA_CODES: SSICCode[] = [{ code: '9301', title: 'Aviation Policy' }];

interface RawSsic {
  codes: { code: string; title: string }[];
}

function groupFor(code: string): number | null {
  const n = parseInt(code, 10);
  if (!Number.isFinite(n)) return null;
  const thousand = Math.floor(n / 1000);
  return SSIC_GROUPS.some((g) => g.thousand === thousand) ? thousand : null;
}

function buildCategories(raw: RawSsic): SSICCategory[] {
  // De-dupe by code so an EXTRA_CODES entry can't double up if a later
  // ssic.json adds it.
  const byCode = new Map<string, SSICCode>();
  for (const entry of [...raw.codes, ...EXTRA_CODES]) {
    if (byCode.has(entry.code)) continue;
    const description = CODE_DESCRIPTIONS[entry.code];
    byCode.set(entry.code, description ? { ...entry, description } : { ...entry });
  }

  const buckets = new Map<number, SSICCode[]>();
  for (const entry of byCode.values()) {
    const thousand = groupFor(entry.code);
    if (thousand === null) continue;
    const bucket = buckets.get(thousand);
    if (bucket) bucket.push(entry);
    else buckets.set(thousand, [entry]);
  }

  return SSIC_GROUPS.flatMap(({ thousand, name }) => {
    const codes = buckets.get(thousand);
    if (!codes || codes.length === 0) return [];
    codes.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return [{ range: `${thousand * 1000}-${thousand * 1000 + 999}`, name, codes }];
  });
}

let cached: Promise<SSICCategory[]> | null = null;

/** SSIC groups with their codes. Caches the parsed result after the first call. */
export function loadSsicCategories(): Promise<SSICCategory[]> {
  cached ??= import('./ssic.json').then((mod) =>
    buildCategories((mod.default ?? mod) as unknown as RawSsic)
  );
  return cached;
}

/** Flat list of every code, for searching the whole set. */
export async function loadAllSsicCodes(): Promise<SSICCode[]> {
  const categories = await loadSsicCategories();
  return categories.flatMap((c) => c.codes);
}
