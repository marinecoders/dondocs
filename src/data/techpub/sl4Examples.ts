import { sl4Schema } from './sl4';

/** Fictional repair parts for the built-in SL-4 example. */
export function sl4Example() {
  return sl4Schema.parse({
    sourceManual: 'Fictional maintenance manual for a training control box',
    standaloneRationale: 'Training example: the maintenance manual has no repair parts listing.',
    cutoffDate: '2026-10-31',
    circuitIndex: { mode: 'include' },
    cages: [{ id: 'training-entity', code: 'ZZ999', name: 'Fictional Training Equipment', address: 'Fictional example only' }],
    notes: [{ id: 'training-note', text: 'Fictional parts, identifiers and quantities are for software demonstrations only.' }],
    rows: [
      { kind: 'heading', id: 'control-heading', text: 'TRAINING CONTROL BOX' },
      { kind: 'part', id: 'kit', nomenclature: 'KIT, Training control box', partNumber: 'TRAIN-KIT', cage: 'ZZ999', isKit: true, quantityPerApplication: '1', quantityPerEquipment: '1' },
      { kind: 'part', id: 'board', parentId: 'kit', nomenclature: 'BOARD, Training circuit', partNumber: 'TRAIN-BOARD', cage: 'ZZ999', quantityPerApplication: '1', quantityPerEquipment: '1', circuitSymbols: ['A1'] },
      { kind: 'part', id: 'screw', parentId: 'kit', nomenclature: 'SCREW, Training fastener', nsn: '5305-00-000-0001', partNumber: 'TRAIN-SCREW', cage: 'ZZ999', mandatoryReplacement: true, quantityPerApplication: '2', quantityPerEquipment: '4' },
      { kind: 'part', id: 'resistor', nomenclature: 'RESISTOR, Training load', nsn: '5905-00-000-0001', partNumber: 'TRAIN-RES', cage: 'ZZ999', economicReplacement: true, quantityPerApplication: '1', quantityPerEquipment: '2', circuitSymbols: ['R1'] },
      { kind: 'part', id: 'resistor-repeat', nomenclature: 'RESISTOR, Training load', nsn: '5905-00-000-0001', partNumber: 'TRAIN-RES', cage: 'ZZ999', quantityPerApplication: '1', circuitSymbols: ['R2'], relationship: { kind: 'same_as', itemIds: ['resistor'] } },
    ],
  });
}
