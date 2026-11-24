export interface DictatedParagraph {
  text: string;
  indent: boolean;
}

const commands = /\bcommand\s+(new\s+paragraph|new\s+line|question\s+mark|comma|period|indent)\b/gi;
const punctuation: Readonly<Record<string, string>> = { period: '.', comma: ',', 'question mark': '?' };

/** Commands use an explicit prefix and are interpreted only in opted-in review. */
export function planParagraphDictation(transcript: string, interpret: boolean): DictatedParagraph[] {
  if (!interpret) return [{ text: transcript.trim(), indent: false }];
  const parts: DictatedParagraph[] = [{ text: '', indent: false }];
  let cursor = 0;
  for (const match of transcript.matchAll(commands)) {
    const item = parts.at(-1)!;
    item.text += transcript.slice(cursor, match.index);
    const command = match[1].toLowerCase().replace(/\s+/g, ' ');
    if (command === 'new paragraph') {
      parts.push({ text: '', indent: false });
    } else if (command === 'indent') {
      if (parts.length > 1 && !item.text.trim()) item.indent = true;
      else item.text += match[0];
    } else if (command === 'new line') {
      item.text = item.text.replace(/[ \t]+$/, '') + '\n';
    } else {
      item.text = item.text.replace(/[ \t]+$/, '') + punctuation[command];
    }
    cursor = match.index + match[0].length;
    if (command === 'new line') {
      while (transcript[cursor] === ' ' || transcript[cursor] === '\t') cursor++;
    }
  }
  parts.at(-1)!.text += transcript.slice(cursor);
  return parts.map((part, index) => ({
    ...part,
    // A leading break in the first fragment belongs between the existing
    // paragraph and the transcript. Drops empty continuations.
    text: index === 0 && part.text.trim() ? part.text.replace(/^[ \t]+/, '').trimEnd() : part.text.trim(),
  })).filter((part, index) => index === 0 || part.text !== '');
}

export function appendDictatedText(original: string, addition: string): string {
  if (!addition) return original;
  const separator = !original || /\s$/.test(original) || /^[\s.,!?;:]/.test(addition) ? '' : ' ';
  return original + separator + addition;
}
