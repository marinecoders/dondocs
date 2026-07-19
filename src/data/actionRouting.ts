/**
 * Advisory routing map for the NAVMC 10274 (Administrative Action) form's
 * "7. To" field: common action types → the section that typically handles them.
 *
 * IMPORTANT — this is a *decision aid, not an authority*. Which office owns an
 * action is command-specific: on IPAC-supported installations a dedicated IPAC
 * section handles it; a unit without IPAC support does the same work in its
 * organic S-1. HQMC-level actions (assignments, records corrections, HQMC
 * promotions) route to a Manpower Management branch, usually via the local
 * S-1/IPAC. So every destination is deliberately *hedged* ("IPAC, or your S-1")
 * and carries a "verify with your unit SOP" caveat in the UI. `authority` is the
 * governing order to check, filled only where it's well established.
 *
 * Stable `id`s exist so a later unit-editable override layer can key custom
 * routing off them without breaking. Pure data — no imports, unit-testable.
 */

export type RoutingLevel = 'local' | 'hqmc';

export interface ActionRoute {
  /** Stable key (never rename — override layers key off it). */
  id: string;
  /** Human-facing action category. */
  category: string;
  /** Lowercase whole-word triggers matched against the "Nature of Action" text. */
  keywords: string[];
  /** Hedged typical destination for the "To" field. */
  destination: string;
  /** One line on who handles it / how to confirm. */
  note: string;
  /** Governing order to verify against, when well established. */
  authority?: string;
  /** Whether it routes to a local section or a HQMC (Manpower) branch. */
  level: RoutingLevel;
}

export const ACTION_ROUTING: readonly ActionRoute[] = [
  {
    id: 'dependents',
    category: 'Dependents / DEERS / ID cards',
    keywords: ['dependent', 'dependents', 'deers', 'id card', 'cac', 'marriage', 'divorce', 'newborn', 'birth', 'family member'],
    destination: 'IPAC Dependent Administration / DEERS-RAPIDS (or your S-1)',
    note: 'Dependency and ID-card actions run through IPAC where supported, otherwise the unit S-1.',
    authority: 'MCO 5000.14D',
    level: 'local',
  },
  {
    id: 'pay',
    category: 'Pay & entitlements (BAH/BAS/COLA)',
    keywords: ['pay', 'bah', 'bas', 'cola', 'entitlement', 'entitlements', 'allotment', 'disbursing', 'mctfs', 'advance pay'],
    destination: 'IPAC Pay Services / Disbursing (or your S-1 pay)',
    note: 'Pay and entitlement changes are an IPAC Pay / Disbursing function, or the unit S-1 pay clerk.',
    authority: 'MCO 5000.14D',
    level: 'local',
  },
  {
    id: 'orders_enlisted',
    category: 'PCS / assignments — enlisted',
    // Note: no bare "orders" — it collides with "TAD orders" / "travel orders".
    // A PCS action is identified by "pcs"/"permanent change"/assignment terms.
    keywords: ['pcs', 'permanent change of station', 'assignment', 'reassignment', 'monitor', 'b-billet', 'special duty'],
    destination: 'HQMC MMEA (Enlisted Assignments) — via your S-1/IPAC',
    note: 'Enlisted assignment/monitor matters go to HQMC MMEA; local orders execution is IPAC Distribution.',
    authority: 'HQMC Manpower Management (MMEA)',
    level: 'hqmc',
  },
  {
    id: 'orders_officer',
    category: 'PCS / assignments — officer',
    keywords: ['officer assignment', 'officer monitor', 'mmoa'],
    destination: 'HQMC MMOA (Officer Assignments) — via your S-1',
    note: 'Officer assignment matters go to HQMC MMOA (ground/aviation sections).',
    authority: 'HQMC Manpower Management (MMOA)',
    level: 'hqmc',
  },
  {
    id: 'reenlistment',
    category: 'Reenlistment / retention / SRB',
    // "extension of enlistment" (not bare "extension", which grabs "extension of
    // leave") and "career retention" (not bare "career").
    keywords: ['reenlist', 'reenlistment', 'retention', 'srb', 'bonus', 'extension of enlistment', 'career retention'],
    destination: 'Unit Career Planner (career retention specialist)',
    note: 'Reenlistment, extensions, and SRB packages route through your unit Career Planner.',
    level: 'local',
  },
  {
    id: 'promotion',
    category: 'Promotions',
    keywords: ['promotion', 'promote', 'meritorious', 'cutting score', 'npc', 'frocking'],
    destination: 'Your S-1 / unit board; HQMC Manpower (Performance Branch) for HQMC-level',
    note: 'Local promotions run through the S-1/unit board; HQMC-level selection is a Manpower Management Performance Branch (MMPB) function.',
    authority: 'HQMC Manpower Management (MMPB)',
    level: 'hqmc',
  },
  {
    id: 'awards',
    category: 'Awards',
    keywords: ['award', 'awards', 'navy achievement', 'navy commendation', 'nam', 'ncm', 'meritorious mast', 'certificate of commendation'],
    destination: 'Your S-1 (Awards) — iPERMS / Awards Processing System',
    note: 'Award recommendations are drafted and tracked by the S-1 awards section.',
    authority: 'SECNAV M-1650.1 (Awards Manual)',
    level: 'local',
  },
  {
    id: 'leave',
    category: 'Leave / liberty',
    keywords: ['leave', 'liberty', 'terminal leave', 'delay', 'permissive'],
    destination: 'Chain of command → your S-1',
    note: 'Leave and liberty are approved in the chain of command and recorded by the S-1.',
    authority: 'MCO 1050.3J',
    level: 'local',
  },
  {
    id: 'tad',
    category: 'TAD / travel',
    keywords: ['tad', 'travel', 'dts', 'tdy', 'per diem', 'travel claim'],
    destination: 'Your S-1 or S-4 (DTS/travel); IPAC TAD where supported',
    note: 'TAD orders and travel claims are handled by the S-1/S-4 travel section (DTS).',
    level: 'local',
  },
  {
    id: 'separation',
    category: 'Separation / EAS / retirement',
    keywords: ['separation', 'separate', 'discharge', 'retire', 'retirement', 'terminal', 'end of active service'],
    destination: 'IPAC Separations (or your S-1)',
    note: 'Separations, EAS, and retirements are an IPAC Separations function, or the unit S-1.',
    authority: 'MARCORSEPMAN (MCO 1900.16)',
    level: 'local',
  },
  {
    id: 'records',
    category: 'Records correction / OMPF',
    keywords: ['ompf', 'record correction', 'records correction', 'bcnr', 'dd214', 'dd 214', 'page 11 correction', 'record error'],
    destination: 'HQMC MMSB (Records) — via your S-1/IPAC',
    note: 'OMPF/records corrections route to HQMC MMSB (MMSB-20); formal corrections may need the BCNR.',
    authority: 'IRAM (MCO P1070.12K)',
    level: 'hqmc',
  },
  {
    id: 'fitrep',
    category: 'Fitness reports / evaluations',
    keywords: ['fitrep', 'fitness report', 'evaluation', 'proficiency and conduct', 'pro/con'],
    destination: 'Your S-1; HQMC Manpower processes it into the record',
    note: 'Fitness reports are submitted through the S-1 and processed into the record at HQMC Manpower.',
    authority: 'MCO 1610.7B',
    level: 'hqmc',
  },
  {
    id: 'subsistence',
    category: 'Subsistence / meal card',
    keywords: ['meal card', 'comrats', 'subsistence', 'separate rations', 'ration'],
    destination: 'Your S-1 / S-4 (subsistence)',
    note: 'Subsistence/COMRATS actions run through the S-1/S-4 — note the meal-card program is transitioning to MCFMIS point-of-sale.',
    authority: 'MCO 10110.47',
    level: 'local',
  },
  {
    id: 'legal',
    category: 'Legal / NJP / admin action',
    keywords: ['njp', 'legal', 'court-martial', 'court martial', 'article 15', 'admin sep', 'administrative separation'],
    destination: 'SJA / Legal — via your S-1',
    note: 'Legal actions (NJP, admin sep, court-martial matters) go through the SJA/legal office.',
    level: 'local',
  },
  {
    id: 'medical_board',
    category: 'Medical board (MEB/PEB/IDES)',
    keywords: ['meb', 'peb', 'ides', 'medical board', 'medical evaluation board', 'limdu', 'limited duty', 'light duty'],
    destination: 'Your medical (BAS) & S-1 (IDES)',
    note: 'Medical evaluation board actions run through your medical section with S-1 for the IDES package.',
    level: 'local',
  },
] as const;
