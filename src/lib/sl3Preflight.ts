import { SL3_ABBREVIATIONS } from '@/data/techpub/sl3Preface';
import { parse, isValid, parseISO } from 'date-fns';
import {
  sl3Schema,
  orderedSl3Components,
  sl3Depth,
  sl3Portions,
  sl3GroupIds,
} from '@/data/techpub/sl3';
import type { DocumentData, EndItem, Paragraph } from '@/types/document';
import { iTypeClassificationErrors } from './iTypeClassification';
import {
  validateDistributionFillIns,
  validateReasonForStatement,
} from './classificationValidation';
import { validatePublicationDate } from './publicationDate';
import { validateIdentifiers } from './identifiers';
import { validateFigures } from './figures';
import { unfilled } from './requiredField';
import { deriveOverallClassLevel } from './overallClassification';

export function sl3ExportErrors(store: {
  docType: string;
  formData: Partial<DocumentData>;
  paragraphs: Paragraph[];
  endItems?: EndItem[];
}): string[] {
  if (store.docType !== 'sl3') return [];
  const errors: string[] = [];
  const d = store.formData;
  const parsed = sl3Schema.safeParse(d.sl3 ?? {});
  if (!parsed.success)
    return [
      'The SL-3 inventory data is invalid. Restore a valid draft before export.',
    ];
  const data = parsed.data;
  for (const [key, label] of Object.entries({
    shortTitle: 'Short title',
    pcn: 'PCN',
    nomenclature: 'End item nomenclature',
    subject: 'Long title',
    unitLine1: 'Issuing command',
    unitAddress: 'Command address',
    sigTitle: 'Signing authority title',
    sigLast: 'Signatory',
    controllingOffice: 'Controlling office',
    pocEmail: 'Program office email',
  })) {
    if (unfilled(String(d[key as keyof DocumentData] ?? '')))
      errors.push(`${label} is required.`);
  }
  if (
    d.shortTitle &&
    !/^SL-3[- ]\d{4,5}[A-HJ-NP-Z]?(?:[-/][A-Z0-9]+)*$/i.test(
      d.shortTitle.trim(),
    )
  )
    errors.push('Enter the assigned SL-3 short title, as SL-3-12345A.');
  errors.push(
    ...validateIdentifiers({
      pcn: d.pcn,
      endItems: store.endItems ?? [],
      majorItems: [],
    }).map((f) => f.message),
  );
  if (!isValid(parse(d.date?.trim() ?? '', 'd MMM yy', new Date())))
    errors.push('Enter a valid publication date.');
  if (
    d.cuiDistStatement &&
    d.cuiDistStatement !== 'A' &&
    !isValid(parseISO(d.distDate ?? ''))
  )
    errors.push('Enter a valid distribution determination date.');
  if (d.pocEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pocEmail))
    errors.push('Enter a valid program office email.');
  errors.push(
    ...validatePublicationDate(
      d.date ?? '',
      d.publicationSigningDate,
      d.publicationClosedDates,
    ).map((f) => f.message),
  );
  if (!d.publicationSigningDate)
    errors.push('Enter the planned or actual signing date.');
  if (d.fontFamily !== 'times' || d.fontSize !== '10pt')
    errors.push(
      'SL-3 requires Times-compatible text at the template sizes (10-point preface, 9-point inventory).',
    );
  if (d.signatureType !== 'digital')
    errors.push('Select a digital signature for SL-3 authentication.');
  if (d.byDirection || /\bby\s+direction\b/i.test(d.sigTitle ?? ''))
    errors.push(
      'SL-3 authentication cannot be signed by direction (MCO 5215.17D, paragraph 4.b(4)(f)).',
    );
  errors.push(
    ...iTypeClassificationErrors(d, [
      ...store.paragraphs,
      ...sl3Portions(data),
    ]).map((error) => error.replaceAll('I-Type', 'SL-3')),
  );
  if (!/^[A-F]$/.test(d.cuiDistStatement ?? ''))
    errors.push('Select Distribution Statement A, B, C, D, E or F.');
  errors.push(
    ...validateDistributionFillIns(d.cuiDistStatement, {
      reason: d.distReason,
      date: d.distDate,
      office: d.controllingOffice,
    }).map((f) => f.message),
  );
  errors.push(
    ...validateReasonForStatement(d.cuiDistStatement, d.distReason).map(
      (f) => f.message,
    ),
  );
  const level = deriveOverallClassLevel(d.classLevel, [
    ...store.paragraphs,
    ...sl3Portions(data),
  ]);
  if (level !== deriveOverallClassLevel(d.classLevel, store.paragraphs))
    errors.push(
      'Set the document classification to cover the highest component, note or technical-data marking.',
    );
  if (
    d.cuiDistStatement === 'A' &&
    (!['unclassified', 'custom'].includes(level) || d.exportRestricted)
  )
    errors.push(
      'Distribution Statement A conflicts with the selected control markings.',
    );
  if (d.distReason === 'Export Controlled' && !d.exportRestricted)
    errors.push(
      'Include the export-control warning for Export Controlled information.',
    );
  if (
    d.exportRestricted &&
    (!['B', 'C', 'D', 'E'].includes(d.cuiDistStatement ?? '') ||
      d.distReason !== 'Export Controlled')
  )
    errors.push(
      'Export-controlled information requires Statement B, C, D or E with the reason Export Controlled.',
    );
  if (
    level === 'cui' &&
    (!d.cuiControlledBy?.trim() ||
      !d.cuiCategory?.trim() ||
      !d.pocEmail?.trim())
  )
    errors.push('Complete the CUI designation block.');
  if (!store.endItems?.length) errors.push('Add at least one end item.');
  if (
    store.endItems?.some(
      (item) => !Object.values(item).some((value) => value.trim()),
    )
  )
    errors.push('Complete or remove empty end item entries.');
  if (unfilled(data.technicalData))
    errors.push('Enter the end item technical data.');
  if (unfilled(data.sourceManual))
    errors.push(
      'Identify the source technical manual for this standalone SL-3 extract.',
    );
  if (
    data.components.some(
      (item) => item.tamcn || item.primaryTamcn || item.configurationRatio,
    ) &&
    unfilled(data.configurationReference)
  )
    errors.push(
      'Identify the TFSMS configuration source for the TAMCN associations and ratios.',
    );
  if (
    (data.showFigureReference || data.showModel) &&
    unfilled(data.fieldingPlanReference)
  )
    errors.push(
      'Identify the Fielding Plan authorizing the optional inventory columns.',
    );
  if (!data.components.length) errors.push('Add the SL-3 components.');
  const items = orderedSl3Components(data);
  const ids = new Set<string>();
  const figures = store.paragraphs.filter((p) => p.figure);
  const figureIds = new Set(figures.map((p) => p.referenceId));
  if (figureIds.size !== figures.length)
    errors.push('Illustration IDs must be unique.');
  const noteIds = new Set(data.notes.map((note) => note.id));
  if (noteIds.size !== data.notes.length)
    errors.push('Special note IDs must be unique.');
  for (const [i, item] of items.entries()) {
    const label = `Item ${i + 1}`;
    if (ids.has(item.id)) errors.push('Component IDs must be unique.');
    ids.add(item.id);
    if (unfilled(item.nomenclature))
      errors.push(`${label}: enter the official nomenclature.`);
    if (!item.unit.trim()) errors.push(`${label}: enter the unit of measure.`);
    if (!item.unitOfIssue.trim())
      errors.push(`${label}: enter the unit of issue.`);
    if (
      !/^\d+(?:\.\d+)?$/.test(item.quantity) ||
      !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) <= 0
    )
      errors.push(`${label}: enter a positive quantity.`);
    if (item.nsn && !/^(\d{4}-\d{2}-\d{3}-\d{4}|\d{13})$/.test(item.nsn))
      errors.push(
        `${label}: enter a valid NSN or leave it blank when unassigned.`,
      );
    if (item.tamcn && !/^[A-Z]\d{5}[A-Z]$/.test(item.tamcn))
      errors.push(`${label}: enter a valid seven-position TAMCN.`);
    const hasAssociation = !!(
      item.tamcn ||
      item.primaryTamcn ||
      item.configurationRatio
    );
    if (hasAssociation && !item.tamcn)
      errors.push(`${label}: enter the associated component TAMCN.`);
    if (
      hasAssociation &&
      (!item.primaryTamcn ||
        !(store.endItems ?? []).some(
          (endItem) => endItem.tamcn === item.primaryTamcn,
        ))
    )
      errors.push(
        `${label}: associate its TAMCN with a primary end item TAMCN on the cover.`,
      );
    if (
      hasAssociation &&
      (!/^\d+:\d+$/.test(item.configurationRatio) ||
        item.configurationRatio
          .split(':')
          .some(
            (value) => !Number.isFinite(Number(value)) || Number(value) <= 0,
          ))
    )
      errors.push(
        `${label}: enter the approved primary-to-component configuration ratio, such as 1:2.`,
      );
    if (item.idNumber && !/^\d{5}[A-HJ-NP-Z]$/.test(item.idNumber))
      errors.push(`${label}: enter a valid assigned ID number.`);
    if (item.cage && !/^[A-Z0-9]{5}$/i.test(item.cage))
      errors.push(`${label}: a CAGE code has five letters or digits.`);
    if (!item.nsn && (!item.partNumber.trim() || !item.cage.trim()))
      errors.push(
        `${label}: provide a part number and CAGE when an NSN is unassigned.`,
      );
    if (item.parentId) {
      const parentIndex = items.findIndex((p) => p.id === item.parentId);
      if (
        parentIndex < 0 ||
        parentIndex >= i ||
        items[parentIndex].category !== item.category
      )
        errors.push(
          `${label}: the parent must precede its components in the same category.`,
        );
      if (sl3Depth(item, items) > 2)
        errors.push(`${label}: use no more than two component nesting levels.`);
      // A subtree must be contiguous in the inventory, never separated by a sibling root.
      const parentGroup = sl3GroupIds(item.parentId, items);
      for (let j = parentIndex + 1; parentIndex >= 0 && j < i; j++) {
        if (!parentGroup.has(items[j].id)) {
          errors.push(
            `${label}: keep components directly after their parent group.`,
          );
          break;
        }
      }
    }
    if (item.figureId && !figureIds.has(item.figureId))
      errors.push(`${label}: its illustration is missing.`);
    if (item.noteIds.some((id) => !noteIds.has(id)))
      errors.push(`${label}: a referenced special note is missing.`);
  }
  if (!data.sequencingNote.trim()) {
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const key = `${item.category}/${item.parentId}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const siblings of groups.values()) {
      if (
        siblings.some(
          (item, i) =>
            i > 0 &&
            siblings[i - 1].nomenclature.localeCompare(
              item.nomenclature,
              undefined,
              { sensitivity: 'base', numeric: true },
            ) > 0,
        )
      )
        errors.push(
          'List items alphabetically within each category and component group, or explain the sequencing under Special Notes.',
        );
    }
  }
  const usedFigures = new Set(
    [data.endItemFigureId, ...items.map((item) => item.figureId)].filter(
      Boolean,
    ),
  );
  for (const id of figureIds)
    if (!id || !usedFigures.has(id))
      errors.push(
        'Assign every illustration to the end item or an inventory component.',
      );
  if (data.endItemFigureId && !figureIds.has(data.endItemFigureId))
    errors.push('The end item illustration is missing.');
  const terms = new Set(SL3_ABBREVIATIONS.map(([term]) => term.toUpperCase()));
  for (const definition of data.definitions) {
    const key = definition.term.trim().toUpperCase();
    if (!key || unfilled(definition.meaning))
      errors.push(
        'Complete or remove empty abbreviation, symbol, or applicability definitions.',
      );
    if (terms.has(key))
      errors.push(
        `Definition "${definition.term}" is duplicated or conflicts with a standard definition.`,
      );
    terms.add(key);
  }
  for (const id of usedFigures) {
    const review = data.artwork.find((a) => a.figureId === id);
    if (!review)
      errors.push(
        'Review the lettering in every illustration. Confirm text-free artwork or add all lettering as searchable labels.',
      );
    else if (
      review.lettering === 'labels' &&
      (!review.labels.length ||
        review.labels.some(
          (label) => unfilled(label.text) || /[\r\n]/.test(label.text),
        ))
    )
      errors.push(
        'Provide every illustration label as a complete, single line of searchable text.',
      );
    else if (review.lettering === 'none' && review.labels.length)
      errors.push('Choose searchable labels for an illustration with labels.');
  }
  if (new Set(data.artwork.map((a) => a.figureId)).size !== data.artwork.length)
    errors.push('Each illustration must have only one lettering review.');
  if (data.notes.some((note) => unfilled(note.text)))
    errors.push('Complete or remove empty special notes.');
  errors.push(
    ...validateFigures(store.paragraphs)
      .filter((f) => /has no/.test(f.message))
      .map((f) => f.message),
  );
  if (
    /\[[A-Za-z][^\]\n]{1,250}\]|\{\{[^}]+\}\}|INSERT NOMENCLATURE/i.test(
      JSON.stringify({
        ...data,
        subject: d.subject,
        nomenclature: d.nomenclature,
        figures: store.paragraphs.map((p) => p.text),
      }),
    )
  )
    errors.push('Replace the remaining SL-3 template prompts before export.');
  return [...new Set(errors)];
}
