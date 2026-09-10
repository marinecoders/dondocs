import type { LetterTemplate } from '../types';
import { modificationInstruction } from './modification-instruction';

/**
 * The other three I-Types. The template is one skeleton "using the
 * appropriate paragraphs for the specific I-Type": the Time Compliance Period
 * belongs to a modification, and the Recording Instruction on the signature
 * page follows the publication type on its own.
 */
const MI_ONLY = new Set(['Time Compliance Period']);

function iType(code: 'SI' | 'TI' | 'LI', id: string, name: string, description: string): LetterTemplate {
  return {
    ...modificationInstruction,
    id,
    name,
    description,
    publicationType: code,
    paragraphs: modificationInstruction.paragraphs.filter((p) => !MI_ONLY.has(p.header ?? '')),
  };
}

export const supplyInstruction = iType('SI', 'supply-instruction', 'Supply Instruction (SI)',
  'Directs a supply action on fielded equipment');
export const technicalInstruction = iType('TI', 'technical-instruction', 'Technical Instruction (TI)',
  'Directs a technical action on fielded equipment, with no modification');
export const lubricationInstruction = iType('LI', 'lubrication-instruction', 'Lubrication Instruction (LI)',
  'Directs lubrication of fielded equipment');
