export interface Rank {
  grade: string;
  abbrev: string;
  title: string;
}

export interface RankCategory {
  name: string;
  ranks: Rank[];
}

export interface ServiceRanks {
  service: string;
  suffix: string;
  categories: RankCategory[];
}

export const USMC_RANKS: ServiceRanks = {
  service: 'United States Marine Corps',
  suffix: 'USMC',
  categories: [
    {
      name: 'Enlisted',
      ranks: [
        { grade: 'E-1', abbrev: 'Pvt', title: 'Private' },
        { grade: 'E-2', abbrev: 'PFC', title: 'Private First Class' },
        { grade: 'E-3', abbrev: 'LCpl', title: 'Lance Corporal' },
        { grade: 'E-4', abbrev: 'Cpl', title: 'Corporal' },
        { grade: 'E-5', abbrev: 'Sgt', title: 'Sergeant' },
        { grade: 'E-6', abbrev: 'SSgt', title: 'Staff Sergeant' },
        { grade: 'E-7', abbrev: 'GySgt', title: 'Gunnery Sergeant' },
        { grade: 'E-8', abbrev: 'MSgt', title: 'Master Sergeant' },
        { grade: 'E-8', abbrev: '1stSgt', title: 'First Sergeant' },
        { grade: 'E-9', abbrev: 'MGySgt', title: 'Master Gunnery Sergeant' },
        { grade: 'E-9', abbrev: 'SgtMaj', title: 'Sergeant Major' },
        { grade: 'E-9', abbrev: 'SgtMajMarCor', title: 'Sergeant Major of the Marine Corps' },
      ],
    },
    {
      name: 'Warrant Officer',
      ranks: [
        { grade: 'W-1', abbrev: 'WO', title: 'Warrant Officer' },
        { grade: 'W-2', abbrev: 'CWO2', title: 'Chief Warrant Officer 2' },
        { grade: 'W-3', abbrev: 'CWO3', title: 'Chief Warrant Officer 3' },
        { grade: 'W-4', abbrev: 'CWO4', title: 'Chief Warrant Officer 4' },
        { grade: 'W-5', abbrev: 'CWO5', title: 'Chief Warrant Officer 5' },
      ],
    },
    {
      name: 'Commissioned Officer',
      ranks: [
        { grade: 'O-1', abbrev: '2ndLt', title: 'Second Lieutenant' },
        { grade: 'O-2', abbrev: '1stLt', title: 'First Lieutenant' },
        { grade: 'O-3', abbrev: 'Capt', title: 'Captain' },
        { grade: 'O-4', abbrev: 'Maj', title: 'Major' },
        { grade: 'O-5', abbrev: 'LtCol', title: 'Lieutenant Colonel' },
        { grade: 'O-6', abbrev: 'Col', title: 'Colonel' },
        { grade: 'O-7', abbrev: 'BGen', title: 'Brigadier General' },
        { grade: 'O-8', abbrev: 'MajGen', title: 'Major General' },
        { grade: 'O-9', abbrev: 'LtGen', title: 'Lieutenant General' },
        { grade: 'O-10', abbrev: 'Gen', title: 'General' },
      ],
    },
  ],
};

export const NAVY_RANKS: ServiceRanks = {
  service: 'United States Navy',
  suffix: 'USN',
  categories: [
    {
      name: 'Enlisted',
      ranks: [
        { grade: 'E-1', abbrev: 'SR', title: 'Seaman Recruit' },
        { grade: 'E-2', abbrev: 'SA', title: 'Seaman Apprentice' },
        { grade: 'E-3', abbrev: 'SN', title: 'Seaman' },
        { grade: 'E-4', abbrev: 'PO3', title: 'Petty Officer Third Class' },
        { grade: 'E-5', abbrev: 'PO2', title: 'Petty Officer Second Class' },
        { grade: 'E-6', abbrev: 'PO1', title: 'Petty Officer First Class' },
        { grade: 'E-7', abbrev: 'CPO', title: 'Chief Petty Officer' },
        { grade: 'E-8', abbrev: 'SCPO', title: 'Senior Chief Petty Officer' },
        { grade: 'E-9', abbrev: 'MCPO', title: 'Master Chief Petty Officer' },
        { grade: 'E-9', abbrev: 'CMDCM', title: 'Command Master Chief' },
        { grade: 'E-9', abbrev: 'FLTCM', title: 'Fleet Master Chief' },
        { grade: 'E-9', abbrev: 'FORCM', title: 'Force Master Chief' },
        { grade: 'E-9', abbrev: 'MCPON', title: 'Master Chief Petty Officer of the Navy' },
      ],
    },
    {
      name: 'Warrant Officer',
      ranks: [
        { grade: 'W-2', abbrev: 'CWO2', title: 'Chief Warrant Officer 2' },
        { grade: 'W-3', abbrev: 'CWO3', title: 'Chief Warrant Officer 3' },
        { grade: 'W-4', abbrev: 'CWO4', title: 'Chief Warrant Officer 4' },
        { grade: 'W-5', abbrev: 'CWO5', title: 'Chief Warrant Officer 5' },
      ],
    },
    {
      name: 'Commissioned Officer',
      ranks: [
        { grade: 'O-1', abbrev: 'ENS', title: 'Ensign' },
        { grade: 'O-2', abbrev: 'LTJG', title: 'Lieutenant Junior Grade' },
        { grade: 'O-3', abbrev: 'LT', title: 'Lieutenant' },
        { grade: 'O-4', abbrev: 'LCDR', title: 'Lieutenant Commander' },
        { grade: 'O-5', abbrev: 'CDR', title: 'Commander' },
        { grade: 'O-6', abbrev: 'CAPT', title: 'Captain' },
        { grade: 'O-7', abbrev: 'RDML', title: 'Rear Admiral (Lower Half)' },
        { grade: 'O-8', abbrev: 'RADM', title: 'Rear Admiral (Upper Half)' },
        { grade: 'O-9', abbrev: 'VADM', title: 'Vice Admiral' },
        { grade: 'O-10', abbrev: 'ADM', title: 'Admiral' },
      ],
    },
  ],
};

export const ALL_SERVICE_RANKS: ServiceRanks[] = [USMC_RANKS, NAVY_RANKS];

// Helper to get formatted rank string (e.g., "LtCol, USMC")
export function formatRank(abbrev: string, suffix: string): string {
  return `${abbrev}, ${suffix}`;
}
