import { inflate } from 'pako';
import { uint8ArrayToBase64 } from '@/lib/encoding';
import { PAGE11_OFFICIAL_SHA256 } from '@/services/forms/officialPdfProfiles';
import { detectPlaceholders } from '@/lib/placeholders';
import type { Navmc11811Data } from '@/stores/formStore';
import { assertNavmc11811Fits } from './navmc11811Generator';

// DON Navy Forms record 10104, NAVMC 118(11) Rev. 05-2014.
const ORIGINAL_XREF = 1816113;
const ORIGINAL_FILE_ID = '04f7c86f0828c949abb041a033607144';
const TEMPLATE_PACKET_OFFSET = 1329;
const TEMPLATE_PACKET_LENGTH = 4576;
const PACKETS = [
  ['preamble', 1], ['config', 2], ['template', 3], ['localeSet', 4], ['datasets', 5],
  ['PDFSecurity', 6], ['xmpmeta', 7], ['xfdf', 8], ['form', 64], ['postamble', 9],
] as const;

// PDF AESV2 object keys derived from the published blank's empty user password.
// The digest check binds this layout and these constants to that exact release.
const OBJECT_KEYS = {
  3: '2209ae319041a0b609daaf890b8682fd',
  5: '5aa83fda2d74ffd661bebfaf062eebf2',
  51: '1d439f6d8aead6323537b875048740b3',
  64: '1c7df143a3d3c94527a725eb8949a5f2',
};
type ObjectNumber = keyof typeof OBJECT_KEYS;
export type Page11StandingDates = readonly [firstArticle137: string, secondArticle137: string, sbp: string];
const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function importObjectKey(number: ObjectNumber, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(OBJECT_KEYS[number].match(/.{2}/g)!, pair => Number.parseInt(pair, 16)),
    { name: 'AES-CBC' },
    false,
    [usage],
  );
}

async function checksumForFormState(original: ArrayBuffer, datasets: string): Promise<string> {
  const packet = new Uint8Array(original, TEMPLATE_PACKET_OFFSET, TEMPLATE_PACKET_LENGTH);
  const key = await importObjectKey(3, 'decrypt');
  const compressed = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: packet.subarray(0, 16) }, key, packet.subarray(16));
  // Normalize the markup of this exact verified template the way the XFA
  // form-state checksum does. The generated datasets already use this form.
  const template = new TextDecoder().decode(inflate(new Uint8Array(compressed))).trim()
    .replace(/(<\/?[\w:.-]+[^<>]*?)\s+(\/?>)/g, '$1$2')
    .replace(/<([\w:.-]+)([^<>]*?)\/>/g, '<$1$2></$1>');
  const digest = await crypto.subtle.digest('SHA-1', encoder.encode(template + datasets));
  return uint8ArrayToBase64(new Uint8Array(digest));
}

async function encrypt(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, bytes));
  const result = new Uint8Array(iv.length + ciphertext.length);
  result.set(iv);
  result.set(ciphertext, iv.length);
  return result;
}

function xmlText(value: string): string {
  // XML 1.0 text ranges, including supplementary Unicode characters.
  if (/[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(value)) {
    throw new Error('Remove unsupported control characters from the draft.');
  }
  return value.replace(/\r\n?/g, '\n').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function officialPage11FieldValues(data: Navmc11811Data, standingDates: Page11StandingDates) {
  const name = [data.lastName, data.firstName, data.middleName].filter(Boolean).join(', ').toUpperCase();
  const closeOnRight = !!data.remarksTextRight;
  const dateOnRight = closeOnRight && !data.remarksText;
  const left = [data.remarksText, dateOnRight ? '' : data.entryDate].filter(Boolean).join('\n\n');
  const right = [data.remarksTextRight, dateOnRight ? data.entryDate : ''].filter(Boolean).join('\n\n');
  const signatureText = data.signatureBlocks
    .map(block => [block.statement?.trim(), block.name?.trim()].filter(Boolean).join('\n\n\n'))
    .filter(Boolean)
    .join('\n\n\n');
  const appendSignatures = (text: string) => [text, signatureText].filter(Boolean).join('\n\n\n');
  const fields = {
    Date1: standingDates[0], Date2: standingDates[1], Date3: standingDates[2],
    NameLFM: name, Remarks1: closeOnRight ? left : appendSignatures(left),
    Remarks2: closeOnRight ? appendSignatures(right) : '', _11: data.box11.toUpperCase(),
  };
  const edipi = data.edipi.trim();
  return {
    ...fields, EDIPI: edipi,
    NameLFM: fields.NameLFM.replace(/\r\n?/g, '\n'),
    Remarks1: fields.Remarks1.replace(/\r\n?/g, '\n'),
    Remarks2: fields.Remarks2.replace(/\r\n?/g, '\n'),
  };
}

export type Page11FieldValues = ReturnType<typeof officialPage11FieldValues>;

/** Fills the official XFA form. Its original bytes, template, and permissions are preserved. */
export async function generateOfficialPage11Pdf(
  data: Navmc11811Data,
  original: ArrayBuffer,
  standingDates: Page11StandingDates,
): Promise<Uint8Array<ArrayBuffer>> {
  if (data.signatureBlocks.some(block => block.style === 'digital' || block.style === 'image')) {
    throw new Error('The official Page 11 form only supports the saved signature text.');
  }
  if (standingDates.some(date => {
    if (!date) return false;
    const parsed = new Date(date);
    return !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date;
  })) throw new Error('Enter valid counseling dates.');

  const { EDIPI: edipi, ...fields } = officialPage11FieldValues(data, standingDates);
  if ([edipi, ...Object.values(fields)].some(value => detectPlaceholders(value).length > 0)) {
    throw new Error('Fill the remaining draft variables before downloading the official form.');
  }
  if (edipi && !/^\d{10}$/.test(edipi)) throw new Error('Enter a 10-digit EDIPI or leave it blank.');
  if (data.box11.length > 5 || /[\r\n]/.test(data.box11)) throw new Error('Use up to five characters for the SRB page number.');
  await assertNavmc11811Fits({
    ...data, remarksText: fields.Remarks1, remarksTextRight: fields.Remarks2, entryDate: '', signatureBlocks: [],
  });

  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', original))) !== PAGE11_OFFICIAL_SHA256) {
    throw new Error('The official Page 11 PDF could not be verified.');
  }
  if (!edipi && Object.values(fields).every(value => value === '')) return new Uint8Array(original);

  const [datasetsKey, acroFormKey, formKey] = await Promise.all([
    importObjectKey(5, 'encrypt'), importObjectKey(51, 'encrypt'), importObjectKey(64, 'encrypt'),
  ]);
  const encryptedString = async (value: string) => '<' + hex(await encrypt(acroFormKey, encoder.encode(value))) + '>';
  const packetArray = await Promise.all(PACKETS.map(async ([label, ref]) => `${await encryptedString(label)} ${ref} 0 R`));
  const acroForm = `<< /DA ${await encryptedString('/Helv 0 Tf 0 g ')} /DR << /Font <<
    /Arial-BoldMT 21 0 R /Arial-ItalicMT 22 0 R /ArialMT 23 0 R /Helv 24 0 R
    /MyriadPro-Regular 25 0 R /TiRo 57 0 R /TimesNewRomanPSMT 26 0 R
  >> >> /Fields [] /NeedAppearances false /SigFlags 2 /XFA [${packetArray.join(' ')}] >>`;
  const entries = Object.entries(fields).map(([name, value]) => `<${name}>${xmlText(value)}</${name}>`).join('');
  const datasets = `<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><form1>${entries}</form1></xfa:data></xfa:datasets>`;
  // EDIPI has bind match="none" in the official template. Its native value
  // belongs in the saved form DOM instead of the bound datasets packet.
  const checksum = await checksumForFormState(original, datasets);
  const form = `<form checksum="${checksum}" xmlns="http://www.xfa.org/schema/xfa-form/2.8/">`
    + '<subform name="form1"><instanceManager name="_"/><subform>'
    + (edipi ? `<field name="EDIPI"><value><text>${edipi}</text></value></field>` : '')
    + '</subform><pageSet><pageArea name="Page1"/></pageSet></subform></form>';

  const stream = async (key: CryptoKey, xml: string) => {
    const encrypted = await encrypt(key, encoder.encode(xml));
    return [encoder.encode(`<< /Length ${encrypted.length} >>\nstream\n`), encrypted, encoder.encode('\nendstream')];
  };
  const chunks: Uint8Array<ArrayBuffer>[] = [new Uint8Array(original), encoder.encode('\n')];
  let offset = original.byteLength + 1;
  const objectOffsets: [number, number][] = [];
  const appendObject = (number: number, contents: Uint8Array<ArrayBuffer>[]) => {
    objectOffsets.push([number, offset]);
    const object = [encoder.encode(`${number} 0 obj\n`), ...contents, encoder.encode('\nendobj\n')];
    chunks.push(...object);
    offset += object.reduce((total, part) => total + part.length, 0);
  };
  appendObject(5, await stream(datasetsKey, datasets));
  appendObject(51, [encoder.encode(acroForm)]);
  appendObject(64, await stream(formKey, form));
  // Keep the incremental revision in the source PDF's cross-reference stream
  // format. Acrobat opens a revision with a classic table but fails to save it.
  const xrefObject = 65;
  const xrefOffset = offset;
  if (xrefOffset > 0xffffff) throw new Error('The filled Page 11 PDF is too large.');
  const indexedOffsets = [...objectOffsets, [xrefObject, xrefOffset] as const];
  const index = indexedOffsets.map(([number]) => `${number} 1`).join(' ');
  const xref = new Uint8Array(indexedOffsets.length * 5);
  for (const [entry, [, start]] of indexedOffsets.entries()) {
    xref.set([1, start >>> 16, start >>> 8, start, 0], entry * 5);
  }
  const revisionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const xrefDictionary = `<< /Type /XRef /W [1 3 1] /Index [${index}] /Length ${xref.length}
    /Size ${xrefObject + 1} /Root 43 0 R /Info 40 0 R /Encrypt 62 0 R
    /ID [<${ORIGINAL_FILE_ID}> <${revisionId}>] /Prev ${ORIGINAL_XREF} >>\nstream\n`;
  appendObject(xrefObject, [encoder.encode(xrefDictionary), xref, encoder.encode('\nendstream')]);
  chunks.push(encoder.encode(`startxref\n${xrefOffset}\n%%EOF\n`));
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}
