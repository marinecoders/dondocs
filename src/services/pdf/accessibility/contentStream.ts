/** Strict, bounded lexical reading of owned pdfTeX page content. It never
 * searches inside text strings, comments, arrays or image bytes for markers. */
export interface PdfContentValue {
  kind: 'name' | 'number' | 'boolean' | 'null' | 'string' | 'hex' | 'array' | 'dictionary';
  start: number;
  end: number;
  value?: string | number | boolean;
  children?: PdfContentValue[];
}
export interface PdfContentOperation {
  operator: string;
  operands: PdfContentValue[];
  start: number;
  end: number;
}

const OPERATORS = new Set(('q Q cm w J j M d ri i gs m l c v y h re S s f F f* B B* b b* n W W* '
  + 'BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 CS cs SC SCN sc scn G g RG rg K k sh '
  + 'Do MP DP BMC BDC EMC BX EX').split(' '));
const WHITE_BYTES = new Set([0, 9, 10, 12, 13, 32]);
const white = (char: string) => WHITE_BYTES.has(char.charCodeAt(0));
const delimiter = (char: string) => white(char) || '()[]<>/%'.includes(char);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

export function readPdfContent(source: string, maxValues = 250_000): PdfContentOperation[] {
  if (source.length > 8 * 1024 * 1024) throw new Error('Tagged PDF page content exceeds 8 MiB.');
  let at = 0;
  let count = 0;
  const fail = (detail: string): never => { throw new Error(`Unsupported PDF content at byte ${at}: ${detail}`); };
  const space = () => {
    while (at < source.length) {
      if (white(source[at])) { at++; continue; }
      if (source[at] !== '%') break;
      while (at < source.length && !/[\r\n]/.test(source[at])) at++;
    }
  };
  const value = (depth: number): PdfContentValue => {
    if (++count > maxValues || depth > 48) fail('object count or nesting limit');
    space();
    const start = at;
    const first = source[at++];
    if (first === '(') {
      let nesting = 1;
      while (at < source.length && nesting) {
        const char = source[at++];
        if (char === '\\') {
          if (at >= source.length) fail('unterminated string escape');
          if (source[at++] === '\r' && source[at] === '\n') at++;
        } else if (char === '(') nesting++;
        else if (char === ')') nesting--;
        if (nesting > 48) fail('string nesting limit');
      }
      if (nesting) fail('unterminated literal string');
      return { kind: 'string', start, end: at };
    }
    if (first === '<' && source[at] !== '<') {
      while (at < source.length && source[at] !== '>') {
        if (!/[0-9a-fA-F]/.test(source[at]) && !white(source[at])) fail('invalid hexadecimal string');
        at++;
      }
      if (source[at++] !== '>') fail('unterminated hexadecimal string');
      return { kind: 'hex', start, end: at, value: source.slice(start + 1, at - 1).replace(/\s/g, '').toLowerCase() };
    }
    if (first === '[' || (first === '<' && source[at] === '<')) {
      const dictionary = first === '<';
      if (dictionary) at++;
      const children: PdfContentValue[] = [];
      while (at < source.length) {
        space();
        if ((!dictionary && source[at] === ']') || (dictionary && source.slice(at, at + 2) === '>>')) {
          at += dictionary ? 2 : 1;
          if (dictionary && children.length % 2) fail('dictionary key without value');
          return { kind: dictionary ? 'dictionary' : 'array', start, end: at, children };
        }
        if (dictionary && children.length % 2 === 0 && source[at] !== '/') fail('dictionary key must be a name');
        children.push(value(depth + 1));
      }
      return fail('unterminated array or dictionary');
    }
    if (first === '/') {
      while (at < source.length && !delimiter(source[at])) at++;
      const raw = source.slice(start + 1, at);
      if (/#(?![a-fA-F0-9]{2})/.test(raw)) fail('invalid name escape');
      return { kind: 'name', start, end: at, value: raw.replace(/#([a-fA-F0-9]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))) };
    }
    while (at < source.length && !delimiter(source[at])) at++;
    const raw = source.slice(start, at);
    if (NUMBER.test(raw) && Number.isFinite(Number(raw))) return { kind: 'number', start, end: at, value: Number(raw) };
    if (raw === 'true' || raw === 'false') return { kind: 'boolean', start, end: at, value: raw === 'true' };
    if (raw === 'null') return { kind: 'null', start, end: at };
    return fail('invalid operand');
  };
  const result: PdfContentOperation[] = [];
  let operands: PdfContentValue[] = [];
  while (at < source.length) {
    space();
    if (at >= source.length) break;
    const start = at;
    const keyword = ['true', 'false', 'null'].some(word => source.startsWith(word, at)
      && (at + word.length === source.length || delimiter(source[at + word.length])));
    if (/[/([<+\-.0-9]/.test(source[at]) || keyword) {
      operands.push(value(0));
      continue;
    }
    while (at < source.length && !delimiter(source[at])) at++;
    if (at === start) fail('unexpected delimiter');
    const operator = source.slice(start, at);
    if (operator === 'BI' || operator === 'ID' || operator === 'EI') fail('inline images are not qualified for tagged output');
    if (!OPERATORS.has(operator)) fail(`unknown operator ${operator}`);
    if (++count > maxValues) fail('operation count limit');
    result.push({ operator, operands, start: operands[0]?.start ?? start, end: at });
    operands = [];
  }
  if (operands.length) fail('operands without an operator');
  return result;
}

export function byteString(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return result;
}

export function byteStringBytes(text: string): Uint8Array {
  return Uint8Array.from(text, char => char.charCodeAt(0));
}
