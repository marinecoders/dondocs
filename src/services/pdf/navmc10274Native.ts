import { officialEdition } from '@/services/forms/nativeCatalog';
import { fillOfficialPdf, loadOfficialPdfSource, officialPdfProfile } from '@/services/forms/officialPdfProfiles';
import type { FormSession } from '@/stores/formStore';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { writeNativeWidgetValues } from '@/services/forms/fillNativeAcroForm';
import { resolveFormSignatures } from '@/lib/signatureAssets';
import { administrativeBlockTwelve, paginateBlockTwelve, placeAdministrativeSignature, type Navmc10274Data } from './navmc10274Generator';

const fields = officialEdition('navmc_10274', '2020-07')!.fieldIds!;

export async function fillAdministrativeAction(input: Navmc10274Data, original: ArrayBuffer, print?: { includeCoverPage: boolean }) {
  const data = await resolveFormSignatures(input);
  // The publisher specifies 10-point Times Roman for both multiline fields.
  const metrics = await PDFDocument.load(original, { updateMetadata: false });
  const layout = (name: string) => {
    const rect = metrics.getForm().getTextField(name).acroField.getWidgets()[0].getRectangle();
    // PDF.js spaces a fixed-size multiline appearance evenly across the available height.
    const height = rect.height - 2;
    const capacity = Math.round(height / 13.5);
    const lineHeight = height / capacity;
    return { capacity, width: rect.width - 4, x: rect.x + 2,
      y: rect.y + rect.height - 1 - lineHeight * (1 - 0.35 / 1.35), lineHeight };
  };
  const main = layout(fields.supplementalInfo);
  const continuation = layout(fields.continuation);
  const font = await metrics.embedFont(StandardFonts.TimesRoman);
  const width = Math.min(main.width, continuation.width);
  const composed = administrativeBlockTwelve(data, font, width);
  if (composed.lines.some(line => font.widthOfTextAtSize(line, 10) > width))
    throw new Error('Block 12 contains a line that cannot fit. Split the long word or signer name.');
  const block = paginateBlockTwelve(composed, main.capacity);
  if (block.continuationLines.length > continuation.capacity)
    throw new Error('Block 12 exceeds the continuation page. Shorten it or use an enclosure.');
  const values = { ...data, supplementalInfo: block.pageLines.join('\n'), continuation: block.continuationLines.join('\n') };
  const widgets = Object.entries(fields).map(([id, name]) => ({ name, value: values[id as keyof typeof fields] }));
  const filled = await writeNativeWidgetValues(new Uint8Array(original.slice(0)), widgets.filter(widget => widget.value));
  if (!print && !block.fieldPlacements.length) return filled;

  // The publisher supplies no signature widgets. Preserve the editable text widgets
  // when a drafter explicitly adds a signing field or scanned signature.
  const pdf = await PDFDocument.load(filled, { updateMetadata: false });
  const positions = block.fieldPlacements.map(placement => {
    return placement.page === 'main' ? { page: pdf.getPage(1), box: main, placement }
      : { page: pdf.getPage(2), box: continuation, placement };
  });
  if (print) {
    const form = pdf.getForm();
    // Some Unicode values need the reader to draw the field with its own fonts.
    // Flattening before that happens would discard the editable value.
    for (const { name, value } of widgets) {
      if (value && form.getTextField(name).acroField.getWidgets().some(widget => !widget.AP()?.has(PDFName.of('N')))) {
        throw new Error('The official form font cannot print this text. Download the editable PDF and print it from a PDF reader.');
      }
    }
    for (const field of form.getFields()) {
      if (field.getName().endsWith('.ResetButton2[0]')) form.removeField(field);
    }
    form.flatten({ updateFieldAppearances: false });
    if (!block.continuationLines.length) pdf.removePage(2);
    if (!print.includeCoverPage) pdf.removePage(0);
  }
  let signatureNumber = 1;
  for (const { page, box, placement } of positions) {
    await placeAdministrativeSignature(pdf, placement.style === 'digital' ? signatureNumber++ : 0, page, placement, box);
  }
  return new Uint8Array(await pdf.save({ updateFieldAppearances: false }));
}

export async function renderOfficialAdministrativePrint(forms: FormSession) {
  const profile = officialPdfProfile('navmc_10274', forms.officialPdfEdition)!;
  return fillOfficialPdf(profile, forms, await loadOfficialPdfSource(profile), 'printable');
}
