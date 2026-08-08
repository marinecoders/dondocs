/**
 * The underscore escape must not become an injection vector.
 *
 * `processBodyText` emits `\_` for a literal underscore. That is only safe
 * because every backslash in the INPUT was already neutralised to
 * `\textbackslash{}` before that point — so a user cannot supply a `\` that
 * pairs with it into a live command. These lock that invariant.
 */
import { describe, it, expect } from 'vitest';
import { processBodyText } from '@/services/latex/escaper';

describe('underscore escaping is not an injection vector', () => {
  it('escapes a literal underscore', () => {
    expect(processBodyText('a_b')).toBe('a\\_b');
  });

  it.each([
    ['\\_', 'a backslash the user typed before an underscore'],
    ['\\\\_', 'a doubled backslash'],
    ['\\input{/etc/passwd}_x', 'a command with an underscore after it'],
    ['_\\catcode`\\_=13_', 'an attempt to redefine the underscore catcode'],
    ['\\csname _ \\endcsname', 'an attempt to build a control sequence'],
  ])('neutralises %j — %s', (input) => {
    const out = processBodyText(input);
    // Every backslash the user supplied is inert text.
    expect(out).not.toMatch(/\\input/);
    expect(out).not.toMatch(/\\catcode/);
    expect(out).not.toMatch(/\\csname/);
    // Any command-looking sequence that survives is one the escaper emitted.
    for (const cmd of out.match(/\\[a-zA-Z]+/g) ?? []) {
      expect(['\\textbackslash', '\\uline', '\\textit', '\\textbf', '\\fcolorbox', '\\textsf', '\\small', '\\char', '\\textasciitilde', '\\textasciicircum']).toContain(cmd);
    }
  });

  it('leaves the underline marker as a command, not literal underscores', () => {
    expect(processBodyText('The __deadline__ is firm.')).toBe('The \\uline{deadline} is firm.');
  });
});
