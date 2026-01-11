// SSIC (Standard Subject Identification Code) Reference Data
// Based on SECNAV M-5210.2 (Department of the Navy Standard Subject Identification Codes)

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

export const SSIC_CATEGORIES: SSICCategory[] = [
  {
    range: '1000-1999',
    name: 'Military Personnel',
    codes: [
      { code: '1000', title: 'General Military Personnel Matters', description: 'General matters relating to military personnel' },
      { code: '1001', title: 'Military Personnel Policy' },
      { code: '1040', title: 'Promotions and Advancements' },
      { code: '1050', title: 'Officer Procurement and Training' },
      { code: '1070', title: 'Classification and Assignment' },
      { code: '1080', title: 'Military Awards and Decorations' },
      { code: '1100', title: 'Manpower Management' },
      { code: '1133', title: 'Billet Structure' },
      { code: '1200', title: 'Military Compensation' },
      { code: '1300', title: 'Recruiting' },
      { code: '1306', title: 'Enlisted Assignments' },
      { code: '1320', title: 'Officer Assignments' },
      { code: '1400', title: 'Separations and Retirements' },
      { code: '1500', title: 'Education and Training', description: 'Military education and professional development' },
      { code: '1510', title: 'Professional Military Education' },
      { code: '1520', title: 'Unit Training' },
      { code: '1540', title: 'Schools and Courses' },
      { code: '1550', title: 'Training Exercises' },
      { code: '1600', title: 'Morale, Welfare, and Recreation' },
      { code: '1610', title: 'Leave and Liberty' },
      { code: '1620', title: 'Morale Programs' },
      { code: '1640', title: 'Recreation Programs' },
      { code: '1650', title: 'Religious Programs' },
      { code: '1700', title: 'Discipline' },
      { code: '1740', title: 'Correctional Programs' },
      { code: '1752', title: 'Alcohol and Drug Abuse Prevention' },
      { code: '1754', title: 'Sexual Assault Prevention' },
    ],
  },
  {
    range: '2000-2999',
    name: 'Telecommunications',
    codes: [
      { code: '2000', title: 'General Telecommunications Matters' },
      { code: '2010', title: 'Communications Policy' },
      { code: '2070', title: 'Frequency Management' },
      { code: '2300', title: 'Telephone Systems' },
      { code: '2400', title: 'Radio Systems' },
    ],
  },
  {
    range: '3000-3999',
    name: 'Operations and Readiness',
    codes: [
      { code: '3000', title: 'General Operations and Readiness', description: 'Operational planning and readiness matters' },
      { code: '3040', title: 'Combat Readiness' },
      { code: '3050', title: 'Joint Operations' },
      { code: '3070', title: 'Exercises and Training Operations' },
      { code: '3100', title: 'Plans and Policy' },
      { code: '3120', title: 'Operations Plans' },
      { code: '3140', title: 'Contingency Plans' },
      { code: '3300', title: 'Deployment' },
      { code: '3400', title: 'Intelligence Operations' },
      { code: '3500', title: 'Force Protection' },
      { code: '3502', title: 'Antiterrorism' },
      { code: '3504', title: 'Physical Security' },
    ],
  },
  {
    range: '4000-4999',
    name: 'Logistics',
    codes: [
      { code: '4000', title: 'General Logistics Matters', description: 'Supply, maintenance, and logistics support' },
      { code: '4100', title: 'Supply Management' },
      { code: '4200', title: 'Transportation' },
      { code: '4300', title: 'Food Service' },
      { code: '4400', title: 'Maintenance Management' },
      { code: '4500', title: 'Facilities Management' },
      { code: '4600', title: 'Contracting' },
      { code: '4700', title: 'Property Management' },
      { code: '4790', title: 'Equipment Disposition' },
    ],
  },
  {
    range: '5000-5999',
    name: 'General Administration and Management',
    codes: [
      { code: '5000', title: 'General Admin and Management', description: 'Administrative policy and procedures' },
      { code: '5040', title: 'Management Programs' },
      { code: '5050', title: 'Managerial Economics' },
      { code: '5100', title: 'Organization and Functions' },
      { code: '5200', title: 'Information Management' },
      { code: '5210', title: 'Records Management', description: 'Filing systems, records retention and disposition' },
      { code: '5211', title: 'NAVMC Forms' },
      { code: '5212', title: 'Directives and Publications' },
      { code: '5214', title: 'Reports Management' },
      { code: '5215', title: 'Forms Management' },
      { code: '5216', title: 'Correspondence', description: 'Official correspondence and memoranda' },
      { code: '5220', title: 'Information Security' },
      { code: '5230', title: 'Privacy Act' },
      { code: '5239', title: 'Cybersecurity' },
      { code: '5300', title: 'History and Museums' },
      { code: '5310', title: 'Historical Records' },
      { code: '5400', title: 'Public Affairs' },
      { code: '5430', title: 'Public Relations' },
      { code: '5450', title: 'Community Relations' },
      { code: '5500', title: 'Inspections' },
      { code: '5510', title: 'Command Inspections' },
      { code: '5520', title: 'Inspector General' },
      { code: '5530', title: 'Investigations' },
      { code: '5580', title: 'Law Enforcement' },
      { code: '5600', title: 'Legal Services' },
      { code: '5700', title: 'Visual Information' },
      { code: '5720', title: 'Photography' },
      { code: '5800', title: 'Equal Opportunity' },
      { code: '5900', title: 'Printing and Publications' },
    ],
  },
  {
    range: '6000-6999',
    name: 'Medicine and Dentistry',
    codes: [
      { code: '6000', title: 'General Medical and Dental', description: 'Medical and dental services' },
      { code: '6100', title: 'Medical Readiness' },
      { code: '6110', title: 'Physical Examinations' },
      { code: '6150', title: 'Medical Records' },
      { code: '6200', title: 'Environmental Health' },
      { code: '6210', title: 'Preventive Medicine' },
      { code: '6220', title: 'Occupational Health' },
      { code: '6260', title: 'Radiation Health' },
      { code: '6300', title: 'Mental Health' },
      { code: '6320', title: 'Combat Stress' },
    ],
  },
  {
    range: '7000-7999',
    name: 'Financial Management',
    codes: [
      { code: '7000', title: 'General Financial Management', description: 'Budgeting, accounting, and fiscal matters' },
      { code: '7010', title: 'Fiscal Policy' },
      { code: '7100', title: 'Budget Administration' },
      { code: '7110', title: 'Budget Preparation' },
      { code: '7120', title: 'Budget Execution' },
      { code: '7200', title: 'Accounting' },
      { code: '7220', title: 'Fund Administration' },
      { code: '7300', title: 'Disbursing' },
      { code: '7400', title: 'Travel' },
      { code: '7500', title: 'Cost Analysis' },
      { code: '7510', title: 'Economic Analysis' },
    ],
  },
  {
    range: '8000-8999',
    name: 'Ordnance Material',
    codes: [
      { code: '8000', title: 'General Ordnance', description: 'Weapons and ammunition' },
      { code: '8010', title: 'Ordnance Policy' },
      { code: '8020', title: 'Weapons Systems' },
      { code: '8300', title: 'Ammunition' },
      { code: '8350', title: 'Explosives Safety' },
    ],
  },
  {
    range: '9000-9999',
    name: 'Ships, Aircraft, and Weapons Systems',
    codes: [
      { code: '9000', title: 'General Ships and Aircraft', description: 'Vessels and aviation systems' },
      { code: '9080', title: 'Boats and Craft' },
      { code: '9300', title: 'Aviation' },
      { code: '9301', title: 'Aviation Policy' },
      { code: '9400', title: 'Ground Equipment' },
      { code: '9600', title: 'Electronic Equipment' },
    ],
  },
  {
    range: '10000-10999',
    name: 'Facilities and Activities',
    codes: [
      { code: '10000', title: 'General Facilities', description: 'Real property and facilities' },
      { code: '10100', title: 'Facilities Planning' },
      { code: '10110', title: 'Master Planning' },
      { code: '10500', title: 'Environmental Compliance' },
      { code: '10520', title: 'Pollution Prevention' },
    ],
  },
  {
    range: '11000-11999',
    name: 'Civilian Personnel',
    codes: [
      { code: '11000', title: 'General Civilian Personnel', description: 'Civilian workforce management' },
      { code: '11100', title: 'Employment' },
      { code: '11200', title: 'Classification and Position Management' },
      { code: '11300', title: 'Compensation' },
      { code: '11400', title: 'Labor Relations' },
      { code: '11500', title: 'Employee Development' },
    ],
  },
  {
    range: '12000-12999',
    name: 'Science and Technology',
    codes: [
      { code: '12000', title: 'General S&T', description: 'Research and development' },
      { code: '12100', title: 'Research Policy' },
      { code: '12300', title: 'Test and Evaluation' },
      { code: '12600', title: 'Technology Transfer' },
    ],
  },
];

// Flatten all codes for easy searching
export const ALL_SSIC_CODES: SSICCode[] = SSIC_CATEGORIES.flatMap((cat) => cat.codes);

// Quick lookup by code
export const SSIC_BY_CODE: Record<string, SSICCode> = Object.fromEntries(
  ALL_SSIC_CODES.map((code) => [code.code, code])
);
