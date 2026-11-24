import { WINDOW_ENVELOPE_ADDRESS_WIDTH, WINDOW_ENVELOPE_PITCH, type WindowEnvelopeRow } from '@/lib/windowEnvelope';

const WINDOW_ENVELOPE_SLOTS = String.raw`
\newdimen\WindowEnvelopeGap
\newsavebox{\WindowEnvelopeText}
\newcommand{\dondocsWindowSlot}[4]{%
  \par
  \WindowEnvelopeGap=\dimexpr #1bp-1in-\voffset-\topmargin-\headheight-\headsep-\pagetotal\relax
  \ifdim\WindowEnvelopeGap<0pt
    \PackageError{dondocs}{Window-envelope opening blocks overlap}{Shorten the letterhead or use the regular layout.}%
    \WindowEnvelopeGap=0pt
  \fi
  \vskip\WindowEnvelopeGap
  \nointerlineskip
  \sbox{\WindowEnvelopeText}{#4}%
  \ifnum#2=1\relax
    \ifdim\wd\WindowEnvelopeText>${WINDOW_ENVELOPE_ADDRESS_WIDTH}bp
      \PackageError{dondocs}{Window-envelope address line is too wide}{Keep the address within the left half of the sheet.}%
    \fi
  \fi
  \vbox to ${WINDOW_ENVELOPE_PITCH}bp{\vfil\hbox to \textwidth{\kern#3bp\usebox{\WindowEnvelopeText}\hfil}\vfil}%
}`;

export function windowEnvelopeTex(rows: WindowEnvelopeRow[], renderText: (row: WindowEnvelopeRow) => string, underline?: boolean): string {
  const commands = rows.map(row => {
    const { top, kind, indent = 0 } = row;
    const text = renderText(row);
    return `\\dondocsWindowSlot{${top}}{${kind === 'address' ? 1 : 0}}{${indent}}{${kind === 'heading' && underline && text ? `\\uline{${text}}` : text}}`;
  });
  return `${WINDOW_ENVELOPE_SLOTS}\n\\def\\dondocsWindowOpening{${commands.join('%\n')}}\n`;
}
