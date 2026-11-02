import { numberedSl4Parts, SL4_NSN_PATTERN, type Sl4Data, type Sl4Row } from '@/data/techpub/sl4';
import { sl4Occurrences } from './sl4Occurrences';
import { stockPublicationPrompt } from './stockPublicationText';

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export interface Sl4Finding {
  severity: 'error' | 'warning';
  code: string;
  path: (string | number)[];
  message: string;
}

export const isSl4BlockingFinding = (finding: Sl4Finding) => finding.severity === 'error'
  || ['maintenance-review', 'missing-entity', 'nomenclature-case'].includes(finding.code);

/** Validate hierarchy before pagination; never silently sort or repair author data. */
export function sl4HierarchyFindings(rows: readonly Sl4Row[]): Sl4Finding[] {
  const findings: Sl4Finding[] = [];
  const seen = new Map<string, number>();
  const stack: string[] = [];
  for (const [index, row] of rows.entries()) {
    const report = (code: string, message: string) => findings.push({
      severity: 'error', code, path: ['rows', index], message,
    });
    if (seen.has(row.id)) report('duplicate-row', 'Every SL-4 row must have a unique ID.');
    seen.set(row.id, index);
    if (row.kind !== 'part') {
      if (row.kind === 'heading' && row.majorCombination) stack.length = 0;
      // Headings and deliberate blank rows may occur inside a continuing group.
      if (row.kind === 'heading' && !rows.slice(index + 1).some((next) => next.kind === 'part'))
        report('orphan-heading', 'A heading must be followed by content.');
      continue;
    }
    if (!row.parentId) stack.length = 0;
    else {
      const parentDepth = stack.indexOf(row.parentId);
      if (parentDepth < 0)
        report('parent-order', 'Keep every component after its parent in a contiguous top-down group.');
      else stack.length = parentDepth + 1;
    }
    stack.push(row.id);
  }
  return findings;
}

/** Content findings; sl4Preflight adds shared cover, marking, asset and signing checks. */
export function sl4ContentFindings(data: Sl4Data, context?: { figureIds: readonly string[] }): Sl4Finding[] {
  const findings = sl4HierarchyFindings(data.rows);
  const report = (code: string, path: (string | number)[], message: string, severity: 'error' | 'warning' = 'error') =>
    findings.push({ severity, code, path, message });
  const parts = numberedSl4Parts(data.rows);
  const partById = new Map(parts.map((part) => [part.id, part]));
  const occurrences = sl4Occurrences(data.rows);
  const positive = (value: string) => /^\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value)) && Number(value) > 0;
  if (!parts.length) report('no-parts', ['rows'], 'Add the repair parts for Part I.');
  if (!data.sourceManual.trim()) report('source-manual', ['sourceManual'], 'Identify the maintenance technical manual.');
  if (!data.standaloneRationale.trim()) report('standalone-rationale', ['standaloneRationale'], 'Record why a standalone SL-4 is needed when the maintenance manual has no repair parts list.');
  if (!validDate(data.cutoffDate))
    report('cutoff-date', ['cutoffDate'], 'Enter a valid publication cut-off date as YYYY-MM-DD.');
  const symbols = new Set<string>();
  for (const [index, row] of data.rows.entries()) {
    if (row.kind === 'blank') continue;
    const path = ['rows', index];
    if (row.kind === 'heading') {
      if (!row.text.trim()) report('empty-heading', [...path, 'text'], 'Complete or remove the empty heading.');
      continue;
    }
    if (!row.nomenclature.trim()) report('nomenclature', [...path, 'nomenclature'], 'Enter the official item name.');
    const nounName = row.nomenclature.split(',')[0];
    if (nounName !== nounName.toUpperCase())
      report('nomenclature-case', [...path, 'nomenclature'], 'Use capitals for the official item name before the first comma; preserve description acronyms and proper names.', 'warning');
    if (!row.unit.trim()) report('unit', [...path, 'unit'], 'Enter the unit of measure.');
    if (!positive(row.quantityPerApplication)) report('application-quantity', [...path, 'quantityPerApplication'], 'Enter a positive quantity per application.');
    if (row.quantityPerEquipment.trim() && !positive(row.quantityPerEquipment))
      report('equipment-quantity', [...path, 'quantityPerEquipment'], 'Enter a positive consolidated quantity or leave it blank when not applicable.');
    const occurrence = occurrences.get(row.id)!;
    if (occurrence.firstInCombinationId !== row.id && row.relationship?.kind !== 'same_as')
      report('same-as-required', [...path, 'relationship'], 'Identify this duplicate using S/A to its first appearance in the major combination.');
    if (row.quantityPerEquipment.trim() && occurrence.firstInListId !== row.id)
      report('equipment-quantity-repeat', [...path, 'quantityPerEquipment'], 'Enter the consolidated equipment quantity only at the part’s first appearance in this list.');
    if (row.maintenancePart === false && row.quantityPerEquipment.trim())
      report('non-maintenance-total', [...path, 'quantityPerEquipment'], 'Leave the consolidated equipment quantity blank for a non-maintenance part.');
    if (row.maintenancePart === true && occurrence.firstInListId === row.id && !row.quantityPerEquipment.trim())
      report('equipment-quantity-required', [...path, 'quantityPerEquipment'], 'Enter the author-verified consolidated quantity for this maintenance part’s first appearance.');
    if (row.maintenancePart === undefined && occurrence.firstInListId === row.id && !row.quantityPerEquipment.trim())
      report('maintenance-review', [...path, 'maintenancePart'], 'Confirm whether this is a maintenance part requiring a consolidated equipment quantity.', 'warning');
    if (row.nsn.trim() && !SL4_NSN_PATTERN.test(row.nsn.trim()))
      report('nsn', [...path, 'nsn'], 'Enter a thirteen-digit NSN or leave it blank when unassigned.');
    if (row.cage.trim() && !/^[A-Z0-9]{5}$/i.test(row.cage.trim()))
      report('cage', [...path, 'cage'], 'A CAGE code has five letters or digits.');
    // Format validation does not establish an authorized SMR assignment.
    if (row.smr.trim() && !/^[A-Z]{5}$/i.test(row.smr.trim()))
      report('smr-review', [...path, 'smr'], 'Enter a five-letter SMR code and verify its assignment against the applicable SECNAVINST 4410.23 revision.', 'warning');
    if (!row.nsn.trim() && (!row.cage.trim() || !row.partNumber.trim()))
      report('ordering-data', path, 'The unassigned identifier fields may remain blank, but ordering data needs program-office review.', 'warning');
    if (row.relationship) {
      const targets = row.relationship.itemIds;
      if (!targets.length) report('related-item', [...path, 'relationship'], 'Choose the related Part I items or remove this relationship.');
      if (new Set(targets).size !== targets.length)
        report('duplicate-related-item', [...path, 'relationship'], 'List each related item once.');
      if (row.relationship.kind === 'same_as' && targets.length !== 1)
        report('same-as-count', [...path, 'relationship'], 'Same-as identifies exactly one earlier occurrence.');
      for (const targetId of targets) {
        const target = partById.get(targetId);
        if (!target || targetId === row.id)
          report('related-item', [...path, 'relationship'], 'Related items must reference another existing Part I item.');
        else if (row.relationship.kind === 'same_as' && target.itemNumber >= (partById.get(row.id)?.itemNumber ?? 0))
          report('same-as-order', [...path, 'relationship'], 'Same-as must reference an earlier occurrence.');
        else if (row.relationship.kind === 'same_as') {
          if (occurrences.get(targetId)?.combinationId !== occurrence.combinationId)
            report('same-as-combination', [...path, 'relationship'], 'Same-as must reference the first appearance within this major combination.');
          else if (targetId !== occurrence.firstInCombinationId)
            report('same-as-first', [...path, 'relationship'], 'Reference the first appearance, not an intermediate duplicate of this item.');
        }
      }
    }
    for (const [symbolIndex, symbol] of row.circuitSymbols.entries()) {
      if (stockPublicationPrompt(symbol))
        report('template-prompt', [...path, 'circuitSymbols', symbolIndex], 'Replace the remaining circuit-symbol template prompt before publication.');
      const normalized = symbol.trim().toUpperCase();
      if (!normalized || symbols.has(normalized))
        report('circuit-symbol', [...path, 'circuitSymbols'], 'Every circuit symbol must be nonempty and identify one item unambiguously.');
      symbols.add(normalized);
    }
    if (row.isKit) {
      const children = parts.filter((part) => part.parentId === row.id);
      if (!children.length) report('empty-kit', [...path, 'isKit'], 'List the components of this kit immediately after it.');
      if (children.some((child, i) => i > 0 && children[i - 1].nomenclature.trim().toUpperCase() > child.nomenclature.trim().toUpperCase()))
        report('kit-sequence', path, 'List kit components alphabetically within their parent group.');
    }
  }
  // Detect relationship cycles in linear time, including fabricated/assembled
  // references that legitimately point forward in Part I.
  const dependencies = new Map(parts.map((part) => [part.id, new Set((part.relationship?.itemIds ?? []).filter((target) => partById.has(target)))]));
  const dependents = new Map<string, string[]>();
  for (const [partId, targets] of dependencies)
    for (const target of targets) {
      if (!dependents.has(target)) dependents.set(target, []);
      dependents.get(target)!.push(partId);
    }
  const ready = [...dependencies].filter(([, targets]) => !targets.size).map(([partId]) => partId);
  for (let i = 0; i < ready.length; i++)
    for (const dependent of dependents.get(ready[i]) ?? []) {
      const targets = dependencies.get(dependent)!;
      targets.delete(ready[i]);
      if (!targets.size) ready.push(dependent);
    }
  if (ready.length < dependencies.size) report('relationship-cycle', ['rows'], 'Remove the circular same-as, fabrication or assembly references.');
  if (data.circuitIndex.mode === 'not_applicable' && symbols.size)
    report('circuit-applicability', ['circuitIndex'], 'Include the circuit-symbol index for electronic equipment, or record the excessive-quantity omission.');
  if (data.circuitIndex.mode === 'omitted_excessive' && !data.circuitIndex.reason.trim())
    report('circuit-omission', ['circuitIndex', 'reason'], 'Record the reason for omitting an excessive circuit-symbol index.');
  if (data.circuitIndex.mode === 'include' && !symbols.size)
    report('empty-circuit-index', ['circuitIndex'], 'Add circuit symbols or select the applicable omission mode.');
  const codes = new Set<string>();
  for (const [index, cage] of data.cages.entries()) {
    const code = cage.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code) || codes.has(code) || !cage.name.trim())
      report('cage-directory', ['cages', index], 'Complete each CAGE directory entry with a unique five-character code and entity name.');
    codes.add(code);
  }
  const missingCodes = new Set(parts.map((part) => part.cage.trim().toUpperCase()).filter((code) => code && !codes.has(code)));
  for (const code of missingCodes)
    report('missing-entity', ['cages'], `Identify the entity for CAGE ${code}.`, 'warning');
  for (const collection of ['cages', 'notes', 'revisions', 'definitions'] as const) {
    const ids = data[collection].map((block) => block.id);
    if (new Set(ids).size !== ids.length) report('duplicate-block', [collection], `Every ${collection} entry must have a unique ID.`);
  }
  data.notes.forEach((note, index) => {
    if (!note.text.trim()) report('empty-note', ['notes', index], 'Complete or remove the empty special note.');
  });
  data.revisions.forEach((revision, index) => {
    if (![revision.revision, revision.date, revision.description, revision.enteredBy].every((value) => value.trim()))
      report('revision-entry', ['revisions', index], 'Complete or remove the revision record.');
    if (revision.date.trim() && !validDate(revision.date))
      report('revision-date', ['revisions', index, 'date'], 'Enter a valid revision date as YYYY-MM-DD.');
  });
  const checkPrompts = (block: object, path: (string | number)[]) => {
    for (const [field, value] of Object.entries(block))
      if (typeof value === 'string' && !['id', 'parentId', 'figureId', 'endItemFigureId'].includes(field) && stockPublicationPrompt(value))
        report('template-prompt', [...path, field], 'Replace the remaining source-template prompt before publication.');
  };
  checkPrompts(data, []);
  for (const collection of ['rows', 'notes', 'cages', 'revisions', 'definitions'] as const)
    data[collection].forEach((block, index) => checkPrompts(block, [collection, index]));
  data.artwork.forEach((artwork, index) => artwork.labels.forEach((label, labelIndex) =>
    checkPrompts(label, ['artwork', index, 'labels', labelIndex])));
  checkPrompts(data.circuitIndex, ['circuitIndex']);
  if (context) {
    const available = new Set(context.figureIds);
    if (available.size !== context.figureIds.length)
      report('duplicate-figure', ['endItemFigureId'], 'Illustration IDs must be unique.');
    if (!data.endItemFigureId)
      report('end-item-figure', ['endItemFigureId'], 'Assign the end-item illustration.');
    if (data.endItemFigureId && !available.has(data.endItemFigureId))
      report('missing-figure', ['endItemFigureId'], 'The assigned end-item illustration is missing.');
    data.rows.forEach((row, index) => {
      if (row.kind === 'part' && row.figureId && !available.has(row.figureId))
        report('missing-figure', ['rows', index, 'figureId'], 'The assigned component illustration is missing.');
    });
  }
  return findings;
}
