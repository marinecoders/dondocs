const documentFontNames = {
  times: 'Times New Roman',
  courier: 'Courier New',
} as const;

export type DocumentFontFamily = keyof typeof documentFontNames;

export function documentFontName(family?: string): string {
  return documentFontNames[family === 'courier' ? 'courier' : 'times'];
}
