"""Certificate signature appearance for the narrow Page 11 widgets."""

import sys
from dataclasses import dataclass, field
from functools import cache
from io import BytesIO
from unicodedata import normalize

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from pyhanko.pdf_utils import generic
from pyhanko.pdf_utils.content import ResourceType
from pyhanko.pdf_utils.font.opentype import GlyphAccumulator
from pyhanko.stamp import BaseStamp, TextStampStyle


def wrap(value, limit, measure):
    lines = []
    while measure(value) > limit:
        # Break at a space first. A CAC common name can be a single long
        # token, in which case use as many characters as the column fits.
        end = 1
        while end < len(value) and measure(value[:end + 1]) <= limit:
            end += 1
        space = value.rfind(" ", 0, end + 1)
        end = space if space > 0 else end
        lines.append(value[:end])
        value = value[end:].lstrip()
    return [*lines, value] if value else lines


def fit_column(paragraphs, width, height, measure, max_size):
    # Fit both dimensions. Longer identities can use additional lines
    # without clipping the certificate name or the signing time.
    for tenths in range(int(max_size * 10), 0, -1):
        size = tenths / 10
        lines = [line for text in paragraphs for line in wrap(text, width / size, measure)]
        if len(lines) * 1.2 * size <= height:
            return size, lines
    raise ValueError("The signature field is too small for its appearance.")


def signer_name(value, cmap):
    cleaned = normalize("NFC", " ".join((value or "").split()))
    if (cleaned and cleaned.isprintable() and len(cleaned) <= 128
        and all(ord(character) in cmap for character in cleaned)):
        return cleaned
    # The full identity remains in the embedded certificate if the font
    # cannot display its name or the name will not fit the widget.
    return "Signer in certificate"


def certificate_stamp_style(font_file):
    program = BytesIO()
    with TTFont(font_file, lazy=True, recalcTimestamp=False) as font:
        if font["name"].getDebugName(6) != "TimesNewRomanPSMT":
            raise ValueError("The signature appearance requires Times New Roman Regular.")
        # Restricted embedding, no subsetting, or bitmap embedding only.
        if font["OS/2"].fsType & 0x0302:
            raise ValueError("The installed Times New Roman font does not permit embedding a PDF subset.")
        # pyHanko 0.38.2 writes CID advances in the font's own units.
        # Normalize the font to PDF's 1,000-unit glyph space before subsetting.
        if font["head"].unitsPerEm != 1000:
            scale_upem(font, 1000)
        font.save(program)
    return CertificateStampStyle(
        font_program=program.getvalue(),
        timestamp_format="%Y.%m.%d %H:%M:%S %z",
        border_width=0,
    )


@dataclass(frozen=True)
class CertificateStampStyle(TextStampStyle):
    font_program: bytes = field(kw_only=True, repr=False)

    def create_stamp(self, writer, box, text_params):
        return CertificateStamp(writer, self, box, text_params)


class StampFont(GlyphAccumulator):
    def _extract_subset(self, options=None):
        # scale_upem changes the outlines but leaves TrueType grid-fitting
        # programs in their original units. Acrobat executes those programs
        # at small sizes, distorting otherwise correctly positioned letters.
        if options is None:
            options = subset.Options(layout_closure=False)
            options.drop_tables += ["GPOS", "GDEF", "GSUB"]
        options.hinting = False
        super()._extract_subset(options)


class CertificateStamp(BaseStamp):
    def __init__(self, writer, style, box, text_params):
        super().__init__(writer, style, box)
        self.font = StampFont(writer, BytesIO(style.font_program), font_size=1)
        self.name = signer_name(text_params.get("signer"), self.font.tt.getBestCmap())
        local_date, offset = text_params["ts"].rsplit(" ", 1)
        self.date = f"Date: {local_date} {offset[:3]}'{offset[3:]}'"

    def _render_inner_content(self):
        self.set_resource(ResourceType.FONT, generic.pdf_name("/SigText"), self.font.as_resource())

        @cache
        def measure(value):
            return self.font.shape(value, with_actual_text=False).x_advance

        # The form uses two columns of nearly equal width, with 1 pt of
        # outer padding and a gutter of about 1% of the field width.
        width, height = self.box.width, self.box.height
        name_width = width / 2 - 1
        details_x = width * 0.51
        details_width = width - details_x - 1
        columns = (
            (1, [self.name], name_width, height),
            (details_x, [f"Digitally signed by {self.name}", self.date],
             details_width, details_width / measure(self.date)),
        )
        commands = [b"0 g"]
        for x, paragraphs, column_width, max_size in columns:
            size, lines = fit_column(paragraphs, column_width, height - 2, measure, max_size)
            leading = size * 1.2
            # Center each column independently using the font's actual metrics.
            metrics = self.font.tt["hhea"]
            center = (metrics.ascent + metrics.descent) / (2 * self.font.units_per_em)
            baseline = (height + (len(lines) - 1) * leading) / 2 - size * center
            for line in lines:
                commands.append(b"q %.5f 0 0 %.5f %.5f %.5f cm BT /SigText 1 Tf %s ET Q" % (
                    size, size, x, baseline, self.font.shape(line).graphics_ops,
                ))
                baseline -= leading
        return commands


if __name__ == "__main__":
    # The signing service runs this probe before advertising signing support.
    certificate_stamp_style(sys.argv[1])
