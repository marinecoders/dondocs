import type { PDFDocumentProxy } from "pdfjs-dist";

const repeatedFields = [
  ['18 ACCUSED FULL NAME', '23 ACCUSED FULL NAME'],
  ['19 ACCUSED RANK/GRADE', '24 ACCUSED RANK/GRADE'],
  ['20 ACCUSED EDIPI', '25 ACCUSED EDIPI'],
] as const;
const accept = 'I do not demand trial and will accept non-judicial punishment, subject to my right of appeal.';
const demand = 'I demand trial and refuse non-judicial punishment.';
const vessel = 'I cannot demand trial because I am attached to or embarked upon a vessel.';

/** Maintain the official form's dependent fields without executing embedded PDF JavaScript. */
export async function syncUpbFields(pdf: PDFDocumentProxy): Promise<void> {
  const fields = await pdf.getFieldObjects();
  const storage = pdf.annotationStorage;
  function field(name: string): { id: string; value: unknown } {
    const item = fields?.[name]?.[0] as { id?: unknown; value?: unknown } | undefined;
    if (typeof item?.id !== 'string') throw new Error('The official NAVMC 10132 field layout has changed.');
    return { id: item.id, value: item.value };
  }
  function read(name: string): unknown {
    const { id, value } = field(name);
    return (storage.getValue(id, { value }) as { value: unknown }).value;
  }
  function write(name: string, value: unknown) {
    if (typeof value === 'string' && read(name) !== value) {
      storage.setValue(field(name).id, { value });
    }
  }
  for (const [source, target] of repeatedFields) write(target, read(source));

  const selected = read('2 DEMAND');
  const election = Array.isArray(selected) ? selected[0] : selected;
  const refusal = read('2 ACC REFUSE TO SIGN');
  const counsel = read('2 COUNSELOPP');
  let statement = 'BOOKER STATEMENT: Having been advised of the above and fully understanding my rights, I choose to accept NJP.';
  if (election === vessel) {
    statement = '(No Booker statement due to the vessel exception, United States v. Mack, 9 M.J. 300, 320 (C.M.A. 1980).)';
  } else if (refusal === true || refusal === 'Yes') {
    if (election === accept) throw new Error('The election says the accused accepts NJP, while refusal to sign is selected. Review both selections before preparing this form.');
    statement = '(No Booker statement due to refusal to sign.)';
  } else if (election === demand) {
    statement = '(No Booker statement due to refusal of NJP.)';
  } else if ((Array.isArray(counsel) ? counsel[0] : counsel) === 'have not') {
    statement = '(No Booker statement; no opportunity to consult with counsel.)';
  }
  write('2 BOOKER', statement);
}
