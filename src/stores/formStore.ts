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

  // Box 11 - short field (initials, 5 chars max)
  box11: string;
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
  clearNavmc10274: () => void;

  navmc11811: Navmc11811Data;
  setNavmc11811Field: <K extends keyof Navmc11811Data>(key: K, value: Navmc11811Data[K]) => void;
  resetNavmc11811: () => void;
  clearNavmc11811: () => void;
}

// Empty defaults for "Clear All" functionality
const EMPTY_NAVMC_10274: NavmcForm10274Data = {
  actionNo: '',
  ssicFileNo: '',
  date: '',
  from: '',
  via: '',
  orgStation: '',
  to: '',
  natureOfAction: '',
  copyTo: '',
  references: '',
  enclosures: '',
  supplementalInfo: '',
  proposedAction: '',
};

const EMPTY_NAVMC_11811: Navmc11811Data = {
  lastName: '',
  firstName: '',
  middleName: '',
  edipi: '',
  remarksText: '',
  entryDate: '',
  box11: '',
};

const DEFAULT_NAVMC_10274: NavmcForm10274Data = {
  actionNo: '001-25',
  ssicFileNo: '1610',
  date: new Date().toISOString().split('T')[0],
  from: 'SSgt John A. Smith 1234567890/0311 USMC',
  via: '(1) XO, HQCO (2) CO, HQBN',
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

2. As a Marine infantryman, physical fitness is fundamental to your ability to perform your duties and maintain combat readiness. The Marine Corps physical fitness standards exist to ensure that every Marine is capable of meeting the physical demands of combat operations. This failure reflects a lack of dedication to maintaining the standards expected of all Marines and calls into question your commitment to your profession.

3. Your PFT history demonstrates a pattern of declining performance:
   a. January 2024: 245 (2nd Class)
   b. July 2024: 215 (3rd Class)
   c. January 2025: 195 (Failing)

4. You were previously counseled on the following dates regarding unsatisfactory PT performance:
   a. 15 July 2024 - Informal counseling regarding declining PFT scores
   b. 01 September 2024 - Formal counseling regarding failure to meet weight standards
   c. 01 November 2024 - Formal counseling with assignment to unit remedial PT

Despite these counseling efforts and remedial PT opportunities, you have failed to demonstrate improvement and have continued on a downward trajectory.

5. Reference (a) establishes the minimum PFT standards for all Marines. As a Lance Corporal with over two years of service, you are expected to not only meet but exceed these minimum standards. Your current performance is unacceptable and reflects poorly on yourself, this platoon, and the Marine Corps as a whole.

6. You are hereby directed to:
   a. Participate in the Battalion Remedial PT Program effective immediately
   b. Report to the Company Gunnery Sergeant daily at 0500 for additional PT
   c. Maintain a food and exercise log to be reviewed weekly by your squad leader
   d. Attend nutritional counseling with the Battalion Medical Officer
   e. Achieve a passing PFT score (minimum 235 points, 3rd Class) within 90 days
   f. Achieve a 2nd Class PFT score (minimum 250 points) within 180 days

7. Your chain of command will conduct weekly progress evaluations to assess your improvement. These evaluations will include:
   a. Weekly weigh-ins every Monday at 0600
   b. Bi-weekly mock PFT events to track progress
   c. Monthly counseling sessions to document improvement or lack thereof

8. Failure to achieve a passing score on your next scheduled PFT, or failure to comply with the remedial program requirements outlined above, may result in one or more of the following adverse administrative actions:
   a. Processing for administrative separation under reference (b)
   b. Recommendation for non-judicial punishment under Article 92, UCMJ
   c. Adverse Page 11 (6105) entry documenting continued substandard performance
   d. Removal from promotion consideration
   e. Assignment to less desirable duties within the company

9. This counseling is intended to clearly communicate the seriousness of your current situation and to provide you with every opportunity to correct your deficiencies. The Marine Corps invests significant resources in training and developing Marines, and it is your responsibility to maintain the standards that justify that investment.

10. Your signature below acknowledges receipt of this counseling and indicates that you understand the requirements and potential consequences outlined herein. Your signature does not constitute agreement with the contents of this counseling. You have the right to submit a written rebuttal within 10 working days of the date of this counseling.`,
  proposedAction: 'Request entry of adverse Page 11 (6105) entry per MCO 1610.7A. Recommend assignment to Remedial PT Program and monthly progress evaluations.',
};

const DEFAULT_NAVMC_11811: Navmc11811Data = {
  lastName: 'DOE',
  firstName: 'JOHN',
  middleName: 'MICHAEL',
  edipi: '0987654321',
  remarksText: `6105 ADVERSE ENTRY - PFT FAILURE

On 15 Jan 25, failed to meet PFT standards per MCO 6100.13A. Scores: Pull-ups: 2 (min 4); Crunches: 85; Run: 28:45 (max 28:00); Total: 195 (Fail).

Prior counseling: 15 Jul 24, 01 Sep 24, 01 Nov 24. Assigned to Remedial PT Program. Must achieve passing score within 90 days or face admin sep processing.

Acknowledged receipt of NAVMC 10274 dtd 15 Jan 25.

//S//
J. A. SMITH, SSgt, USMC`,
  entryDate: new Date().toISOString().split('T')[0],
  box11: 'JAS',
};

export const useFormStore = create<FormStore>((set) => ({
  navmc10274: { ...DEFAULT_NAVMC_10274 },

  setNavmc10274Field: (key, value) => set((state) => ({
    navmc10274: { ...state.navmc10274, [key]: value },
  })),

  resetNavmc10274: () => set({
    navmc10274: { ...DEFAULT_NAVMC_10274 },
  }),

  clearNavmc10274: () => set({
    navmc10274: { ...EMPTY_NAVMC_10274 },
  }),

  navmc11811: { ...DEFAULT_NAVMC_11811 },

  setNavmc11811Field: (key, value) => set((state) => ({
    navmc11811: { ...state.navmc11811, [key]: value },
  })),

  resetNavmc11811: () => set({
    navmc11811: { ...DEFAULT_NAVMC_11811 },
  }),

  clearNavmc11811: () => set({
    navmc11811: { ...EMPTY_NAVMC_11811 },
  }),
}));
