import { create } from 'zustand';

export interface Navmc11811Data {
  // Marine identification
  lastName: string;
  firstName: string;
  middleName: string;
  edipi: string;
  
  // The main 6105 entry content
  remarksText: string;
  
  // Entry date
  entryDate: string;
}

export interface NavmcForm10274Data {
  // Field 1: Action Number
  actionNo: string;
  // Field 2: SSIC/File Number
  ssicFileNo: string;
  // Field 3: Date
  date: string;
  // Field 4: From
  from: string;
  // Field 5: Via
  via: string;
  // Field 6: Organization/Station
  orgStation: string;
  // Field 7: To
  to: string;
  // Field 8: Nature of Action
  natureOfAction: string;
  // Field 9: Copy To
  copyTo: string;
  // Field 10: References/Authority
  references: string;
  // Field 11: Enclosures
  enclosures: string;
  // Field 12: Supplemental Information (main counseling text)
  supplementalInfo: string;
  // Field 13: Proposed/Recommended Action
  proposedAction: string;
}

interface FormStore {
  navmc10274: NavmcForm10274Data;
  setNavmc10274Field: <K extends keyof NavmcForm10274Data>(key: K, value: NavmcForm10274Data[K]) => void;
  resetNavmc10274: () => void;
  
  navmc11811: Navmc11811Data;
  setNavmc11811Field: <K extends keyof Navmc11811Data>(key: K, value: Navmc11811Data[K]) => void;
  resetNavmc11811: () => void;
}

const DEFAULT_NAVMC_10274: NavmcForm10274Data = {
  actionNo: '001-25',
  ssicFileNo: '1610',
  date: new Date().toISOString().split('T')[0],
  from: 'SSgt Smith, John A., 1234567890, 0311',
  via: 'Platoon Commander, 1st Platoon',
  orgStation: 'Alpha Company, 1st Battalion\n1st Marine Regiment\nCamp Pendleton, CA',
  to: 'LCpl Doe, John M.\n0987654321\n0311',
  natureOfAction: 'Formal Counseling - PFT Failure',
  copyTo: 'Marine\'s SRB\nCompany Office',
  references: '(a) MCO 6100.13A W/CH 1\n(b) MCO 1610.7A\n(c) Unit PT Policy dtd 01 Oct 2024',
  enclosures: '(1) PFT Scorecard dtd 15 Jan 2025',
  supplementalInfo: `1. On 15 January 2025, you failed to achieve the minimum standards on the Physical Fitness Test (PFT) as required by reference (a). Your scores were as follows:

   a. Pull-ups: 2 (minimum 4 required)
   b. Crunches: 85
   c. 3-Mile Run: 28:45 (maximum 28:00 required)
   d. Total Score: 195 (3rd Class, failing)

2. As a Marine infantryman, physical fitness is fundamental to your ability to perform your duties and maintain combat readiness. This failure reflects a lack of dedication to maintaining the standards expected of all Marines.

3. You were previously counseled on 01 November 2024 regarding unsatisfactory PT performance and provided remedial PT opportunities. Despite these efforts, you have failed to demonstrate improvement.

4. You are hereby directed to:
   a. Participate in the Remedial PT Program effective immediately
   b. Report to the Company Gunny daily at 0500 for additional PT
   c. Achieve a passing PFT score within 90 days

5. Failure to achieve a passing score on your next scheduled PFT may result in administrative separation processing under reference (b), or other adverse administrative action as deemed appropriate.

6. Your signature below acknowledges receipt of this counseling. You have the right to submit a written rebuttal within 10 working days.`,
  proposedAction: 'Request entry of adverse Page 11 (6105) entry per MCO 1610.7A. Recommend assignment to Remedial PT Program and monthly progress evaluations.',
};

const DEFAULT_NAVMC_11811: Navmc11811Data = {
  lastName: '',
  firstName: '',
  middleName: '',
  edipi: '',
  remarksText: '',
  entryDate: new Date().toISOString().split('T')[0],
};

export const useFormStore = create<FormStore>((set) => ({
  navmc10274: { ...DEFAULT_NAVMC_10274 },

  setNavmc10274Field: (key, value) => set((state) => ({
    navmc10274: { ...state.navmc10274, [key]: value },
  })),

  resetNavmc10274: () => set({
    navmc10274: { ...DEFAULT_NAVMC_10274 },
  }),

  navmc11811: { ...DEFAULT_NAVMC_11811 },

  setNavmc11811Field: (key, value) => set((state) => ({
    navmc11811: { ...state.navmc11811, [key]: value },
  })),

  resetNavmc11811: () => set({
    navmc11811: { ...DEFAULT_NAVMC_11811 },
  }),
}));
