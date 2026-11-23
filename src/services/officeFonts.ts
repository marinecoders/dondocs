import { documentFontName, type DocumentFontFamily } from './fonts.ts';

function face<Stem extends string>(stem: Stem, postScriptName: string, suffix: string) {
  return { metric: `${stem}8r`, postScriptName, suffix, program: `office-${stem}.ttf`, virtual: `${stem}8t.vf` } as const;
}

const families = {
  times: {
    name: documentFontName('times'),
    faces: {
      regular: face('ptmr', 'TimesNewRomanPSMT', ''),
      bold: face('ptmb', 'TimesNewRomanPS-BoldMT', ' Bold'),
      italic: face('ptmri', 'TimesNewRomanPS-ItalicMT', ' Italic'),
      boldItalic: face('ptmbi', 'TimesNewRomanPS-BoldItalicMT', ' Bold Italic'),
    },
  },
  courier: {
    name: documentFontName('courier'),
    faces: {
      regular: face('pcrr', 'CourierNewPSMT', ''),
      bold: face('pcrb', 'CourierNewPS-BoldMT', ' Bold'),
      italic: face('pcrro', 'CourierNewPS-ItalicMT', ' Italic'),
      boldItalic: face('pcrbo', 'CourierNewPS-BoldItalicMT', ' Bold Italic'),
    },
  },
} as const;

type OfficeFontStyle = keyof typeof families.times.faces;

export const OFFICE_FONT_FACES = Object.values(families).flatMap(({ name, faces }) =>
  Object.values(faces).map(entry => ({ ...entry, diskName: `${name}${entry.suffix}.ttf` })),
);

export const OFFICE_FONT_URL = '/__local_office_fonts/';
export const OFFICE_FONT_ENCODING = 'office-8r.enc';
export const OFFICE_FONT_UNICODE = 'office-glyphtounicode.tex';
export const OFFICE_FONT_FILES = [
  OFFICE_FONT_UNICODE,
  OFFICE_FONT_ENCODING,
  ...OFFICE_FONT_FACES.flatMap(({ program, virtual }) => [program, virtual]),
] as const;

type OfficeFontFile = typeof OFFICE_FONT_FILES[number];
export type OfficeFontAssets = Readonly<Record<OfficeFontFile, Uint8Array>>;

/** A renderer receives its own bytes. It can retain or transfer them independently. */
export class OfficeFontSource {
  readonly #assets: OfficeFontAssets;

  constructor(assets: OfficeFontAssets) {
    this.#assets = structuredClone(assets);
  }

  read(file: OfficeFontFile): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.#assets[file]);
  }

  readFace(family: DocumentFontFamily, style: OfficeFontStyle): Uint8Array<ArrayBuffer> {
    return this.read(families[family].faces[style].program);
  }
}

let localSource: Promise<OfficeFontSource> | undefined;

export function loadLocalOfficeFonts(): Promise<OfficeFontSource> | undefined {
  if (!import.meta.env?.DEV || import.meta.env.VITE_LOCAL_OFFICE_FONTS !== '1') return undefined;
  localSource ??= Promise.all(OFFICE_FONT_FILES.map(async filename => {
    const response = await fetch(OFFICE_FONT_URL + filename);
    if (!response.ok) throw new Error(`Could not load local PDF font asset ${filename}.`);
    return [filename, new Uint8Array(await response.arrayBuffer())] as const;
  })).then(entries => new OfficeFontSource(Object.fromEntries(entries) as OfficeFontAssets)).catch(error => {
    localSource = undefined;
    throw error;
  });
  return localSource;
}
