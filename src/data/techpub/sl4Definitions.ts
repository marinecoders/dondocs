import { SL3_ABBREVIATIONS } from './sl3Preface';
import type { Sl4Data } from './sl4';

const common = new Set(['CAGE', 'CMC', 'COMMARCORSYSCOM', 'CTI', 'CUI', 'DC', 'DCI', 'EA', 'EDO', 'EXPT', 'FOUO', 'ID', 'KBA', 'L', 'MC', 'MCO', 'No.', 'NOFORN', 'NSN', 'PAE', 'PCN', 'PdM', 'PEO', 'PM', 'POC', 'PPO', 'SCI', 'SD', 'SL', 'TAMCN', 'TDM', 'TM', 'U.S.', 'U/M', 'USMC', 'VA']);
export const SL4_ABBREVIATIONS: readonly (readonly [string, string])[] = [
  ...SL3_ABBREVIATIONS.filter(([term]) => common.has(term)),
  ['APPL', 'Application'], ['ASSEM FR', 'Assembled from'],
  ['ECO', 'Economic replacement indicator'], ['EQUIP', 'Equipment'],
  ['FAB FR', 'Fabricated from'], ['MAN', 'Mandatory replacement indicator'],
  ['MHIF', 'Master Header Information File'], ['RPL', 'Repair Parts List'],
  ['S/A', 'Same as'], ['SMR', 'Source Maintenance Recoverability'],
  ['c/o', 'Consist of'],
];
export function sl4Definitions(custom: Sl4Data['definitions']) {
  return [...SL4_ABBREVIATIONS.map(([term, meaning]) => ({ term, meaning, portionMarking: 'U' })), ...custom]
    .sort((a, b) => a.term.toUpperCase().localeCompare(b.term.toUpperCase(), 'en'));
}
