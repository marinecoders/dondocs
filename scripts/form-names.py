#!/usr/bin/env python3
"""Turn a DON Forms catalog row into the names the repo files it under.

One module, imported by acquire-form.sh and import-navmc.sh, so the folder a
form is staged into and the id it is registered under are derived exactly once.
The rules below are not guesses — they come from walking the whole registry
(13,859 rows, 10,049 of them Active) and looking at what the data actually
contains:

  * 1,224 Active titles carry a "/" ("SIGN IN / OUT RECORD"). Interpolated
    straight into a path that silently creates a NESTED directory, so the
    pages land somewhere the catalog row does not point at. Every character
    that means something to a filesystem is replaced here, not downstream.
  * 891 Active form numbers have stray leading/trailing whitespace ("DD 285 "),
    which makes one form look like two and leaves untypeable directory names.
  * 229 carry a parenthetical that is NOT "(EF)" — revision stamps like
    "(REV. 10-91)", "(10-2017)", "(12/13)" and qualifiers like "(PAS)",
    "(TEMPLATE)". Welding those into the id splits one form across several
    catalog entries as it gets revised. But "NAVMC 118(11)" is a form whose
    number really does end in parentheses, so a digits-only group is KEPT.
  * 113 Active rows are not forms at all — "LITHO" (39 of them), "N/A", and
    two with an empty number. A form number contains a digit; that one test
    drops all of them without a denylist to maintain.
  * 33 Active titles are HTML, not text — '<span style="font-family: Arial;">
    PARACHUTE LOG' — and 52 more carry entities like "&amp;". Sanitizing those
    characters without first unwrapping them turned a title into
    "-span Style=-font-Family- Arial;-".
  * 47 rows the registry calls Active announce in their own number or title
    that they are dead — "NAVMC 11428 ***CANCELLED BY USMC***",
    "DD 1173 ***INACTIVE***", "NAVSO 10460/32 *CANCELED. EMAIL …*". The status
    field cannot be trusted alone, and importing one stages a cancelled form
    under the id "navmc11428cancelledbyusmc".
  * Folder names ran up to 203 characters. They are capped, on a word
    boundary, so the number and a readable slice of the title both survive.

Nothing here touches the network or the filesystem — it is pure string work so
scripts/test-form-names.py can drive every branch.
"""
import html
import re

# Kept uppercase by title_case. An allowlist, not a length rule: every registry
# title is ALL CAPS, so case carries no signal, and "is it <=4 characters"
# cannot tell BCP from BOOK — it shouted SIGN, OUT, UNIT, DATE and NAME back
# out mid-title. Anything not listed here is title-cased, which at worst
# lowercases an unlisted acronym in a name a human reviews at promote time.
ACRONYMS = {
    'BCP', 'CFT', 'CO', 'CUI', 'EGA', 'FOUO', 'ID', 'II', 'III', 'IV', 'MAP',
    'MCI', 'MOS', 'NCO', 'NJP', 'OIC', 'OMPF', 'PCS', 'PFT', 'PII', 'SNCO',
    'SRB', 'SSIC', 'TAD', 'UPB', 'USMC', 'XO',
}

# Characters that must never reach a path component: the separators, the shell
# and glob metacharacters, and the ones Windows rejects outright.
_UNSAFE = re.compile(r'[/\\:*?"<>|\x00-\x1f]')

# In-band "this form is dead" notices. The registry marks these rows Active
# anyway, so the status field is necessary but not sufficient.
_RETIRED = re.compile(
    r'cancell?ed|\binactive\b|\bon hold\b|obsolete|supersed|rescind|do not use', re.I)

# An asterisk-delimited annotation run, which is where those notices live.
# Requires asterisks on BOTH sides so a form whose number legitimately contains
# one ("NAVMED 5040*6", "NAVMED 6710/*16") keeps it.
_ASTERISK_RUN = re.compile(r'\*+[^*]*\*+')

MAX_FOLDER = 100


def clean_number(raw):
    """Trim the stray whitespace 891 Active rows carry and collapse inner runs."""
    return re.sub(r'\s+', ' ', (raw or '').strip())


def is_form_number(raw):
    """A form number contains a digit. Drops "LITHO", "N/A" and the empties."""
    return bool(re.search(r'\d', clean_number(raw)))


def strip_markers(raw):
    """Drop revision/qualifier parentheticals, keep a digits-only group.

    "(EF)", "(REV. 10-91)", "(10-2017)" and "(12/13)" all describe an edition
    of the form rather than naming it, so they would fragment one form's
    identity across revisions. "NAVMC 118(11)" is the counter-case the rule
    has to survive: the parentheses are part of the number itself.
    """
    out = _ASTERISK_RUN.sub(' ', clean_number(raw))
    out = re.sub(
        r'\(([^)]*)\)',
        lambda m: m.group(1) if re.fullmatch(r'\d+', m.group(1).strip()) else '',
        out)
    return re.sub(r'\s+', ' ', out).strip()


def folder_token(raw):
    """Form number -> the folder's leading token ("OPNAV 1650/3" -> OPNAV1650-3).

    The registry writes the number with a SLASH but the folders keep a DASH, so
    the separator is translated rather than stripped — dropping it produced
    "OPNAV16503", matching neither the folders nor the derived id.
    """
    s = strip_markers(raw).replace('/', '-')
    s = re.sub(r'[^A-Za-z0-9-]', '', s)
    return re.sub(r'-{2,}', '-', s).upper().strip('-')


def norm(raw):
    """Comparison key: "OPNAV 1650/3", "OPNAV1650-3" and "… (EF)" compare equal."""
    return re.sub(r'[^A-Z0-9]', '', strip_markers(raw).upper()).removesuffix('EF')


def clean_title(raw):
    """Registry title -> plain text. Some rows store HTML, not a title.

    Unescaping comes first so an escaped tag ("&lt;span&gt;") is unwrapped and
    then stripped like a literal one; sanitizing before unwrapping is what
    turned a title into "-span Style=-font-Family- Arial;-".
    """
    s = html.unescape(raw or '')
    s = re.sub(r'<[^>]*>', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def is_retired(number, title=''):
    """True when the row says it is cancelled, whatever its status field claims.

    Checked against both fields: some rows carry the notice only in the number
    ("ARMS 105 CANCELLED"), others only in the title ("***CANCELLED BY DON***").
    """
    return bool(_RETIRED.search(f'{number or ""} {clean_title(title)}'))


def has_title(raw):
    """True when the row carries a real title, not blank and not bare markup."""
    return bool(clean_title(raw))


def title_case(raw):
    """ALL-CAPS registry title -> readable title, known acronyms left alone.

    Splits on "/" and "-" so each side of "BCP/PFT" is judged on its own.
    Known limit: an acronym missing from ACRONYMS (STEMI, ACCF) is title-cased
    like a word. That is the safe direction to be wrong — the alternative rule,
    "short and uppercase means acronym", shouted every four-letter English word
    on the form.
    """
    words = []
    for word in re.sub(r'\s+', ' ', (raw or '').strip()).split(' '):
        parts = re.split(r'([/\-])', word)
        words.append(''.join(
            p if p.upper() in ACRONYMS else p.capitalize() for p in parts
        ))
    return ' '.join(w for w in words if w)


def safe_component(raw):
    """Collapse anything path-meaningful so the result is ONE directory.

    A title like "SIGN IN / OUT RECORD" otherwise nests a directory the
    catalog row never points at, and a leading dot hides the folder.
    """
    s = _UNSAFE.sub('-', raw or '')
    s = re.sub(r'-{2,}', '-', s)
    return re.sub(r'\s+', ' ', s).strip(' .')


def folder_name(number, title, max_len=MAX_FOLDER):
    """"NAVMC 11620" + "MAP EVALUATION" -> "NAVMC11620 - MAP Evaluation".

    The token is never truncated — it carries the identity. Only the title is
    trimmed, on a word boundary, when the pair would exceed max_len.
    """
    token = folder_token(number)
    titled = safe_component(title_case(clean_title(title)))
    if not titled:
        return token
    room = max_len - len(token) - 3
    if room > 0 and len(titled) > room:
        cut = titled[:room]
        if ' ' in cut:
            cut = cut[:cut.rfind(' ')]
        titled = cut.strip(' -.')
    return f'{token} - {titled}'.strip(' -') if titled else token


def form_id(folder):
    """Registry id: the folder's number token, lowercased and stripped."""
    return re.sub(r'[^a-z0-9]', '', folder.split(' - ')[0].lower())


def display_number(raw):
    """The number as the form itself prints it — for the catalog's name field.

    Used in preference to inverting folder_token, which cannot be inverted:
    "OPNAV1650-3" could have been "OPNAV 1650/3" or "OPNAV 1650-3", and
    "HQ-NRL5100-17" defeats a leading-prefix rule entirely.
    """
    return strip_markers(raw)


def display_name(folder, number=''):
    """Folder -> user-facing "NUMBER - Title".

    Prefers the registry's own form number when the caller has it; otherwise
    falls back to re-spacing the token, which is a heuristic and says so.
    """
    token, sep, title = folder.partition(' - ')
    if number and is_form_number(number):
        num = display_number(number)
    else:
        num = re.sub(r'^NAVMCHQ(?=\d)', 'NAVMC HQ ', token)
        num = re.sub(r'^([A-Z]+)(?=\d)', r'\1 ', num)
    return f'{num}{sep}{title}' if sep else num
