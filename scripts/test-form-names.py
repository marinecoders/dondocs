#!/usr/bin/env python3
"""Drive scripts/form-names.py over the shapes the real registry contains.

Every case below is a verbatim formNumber or formTitle observed while walking
the DON Forms catalog (13,859 rows). The naming rules decide what directory a
form is staged into and what id it is registered under, so a regression here
misfiles forms or collides two of them onto one catalog row — and neither is
visible until someone opens the app.

Run: python3 scripts/test-form-names.py   (no network, no PDFs, no poppler)
"""
import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('form_names', HERE / 'form-names.py')
fn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fn)

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def eq(got, want, msg):
    check(got == want, f'{msg}: got {got!r}, want {want!r}')


# --- the bug this module exists to fix -------------------------------------
# 1,224 Active titles carry a "/". Interpolated into a path it creates a nested
# directory, so the pages land where the catalog row does not point.
folder = fn.folder_name('NNMC (0104) 5330/3', 'SIGN IN / OUT RECORD')
check('/' not in folder and '\\' not in folder,
      f'folder name must be one path component, got {folder!r}')
eq(folder, 'NNMC01045330-3 - Sign In - Out Record', 'slash-bearing title')

for title in ['SIGN IN / OUT RECORD', 'OVER-RING/REFUND VOUCHER', 'A\\B REPORT',
              'PLANNING CALENDAR (8 1/2 X11)', 'DIRECTIVE/RPT REF RECORD']:
    got = fn.folder_name('OPNAV 1650/3', title)
    check('/' not in got and '\\' not in got, f'{title!r} leaked a separator: {got!r}')

# A hyphenated word must survive the sanitizer intact.
eq(fn.safe_component('Over-ring Voucher'), 'Over-ring Voucher', 'hyphen preserved')
# A leading dot would hide the directory.
check(not fn.folder_name('DD 285', '.HIDDEN REPORT').split(' - ')[-1].startswith('.'),
      'leading dot must not survive into the folder name')

# --- form numbers ----------------------------------------------------------
eq(fn.folder_token('NAVMC 11620'), 'NAVMC11620', 'plain NAVMC')
eq(fn.folder_token('OPNAV 1650/3'), 'OPNAV1650-3', 'slash becomes dash')
eq(fn.folder_token('NAVMC 11620 (EF)'), 'NAVMC11620', '(EF) dropped')
eq(fn.folder_token('DD 285 '), 'DD285', 'trailing space trimmed')
eq(fn.folder_token(' N/A '), 'N-A', 'junk still tokenizes (the digit gate rejects it)')
eq(fn.folder_token('HQ-NRL 5100/17'), 'HQ-NRL5100-17', 'dashed family prefix')
eq(fn.folder_token('NAVMC HQ 029'), 'NAVMCHQ029', 'two-word family prefix')

# "NAVMC 118(11)" is a form whose number really ends in parentheses — the
# existing hand-built form is filed as NAVMC11811, so a digits-only group is
# KEPT while revision markers are dropped.
eq(fn.folder_token('NAVMC 118(11)'), 'NAVMC11811', 'digits-only parenthetical kept')
eq(fn.folder_token('HQ-NRL 5100/17 (REV. 10-91)'), 'HQ-NRL5100-17', 'revision stamp dropped')
eq(fn.folder_token('NAVMC 10132 (10-2017)'), 'NAVMC10132', 'date stamp dropped')
eq(fn.folder_token('SOME 123 (12/13)'), 'SOME123', 'slashed date stamp dropped')
eq(fn.folder_token('FD 258 (PAS)'), 'FD258', 'qualifier dropped')
eq(fn.folder_token('SF 135 (MC USE ONLY)'), 'SF135', 'multi-word qualifier dropped')

# Two revisions of one form must land on ONE id, not fragment the catalog.
eq(fn.folder_token('HQ-NRL 5100/17 (REV. 10-91)'),
   fn.folder_token('HQ-NRL 5100/17 (REV. 2-03)'), 'revisions share an id')
eq(fn.norm('OPNAV 1650/3'), fn.norm('OPNAV 1650/3 (EF)'), 'EF variant compares equal')
eq(fn.norm('DD 285 '), fn.norm('DD 285'), 'whitespace variant compares equal')

# --- the junk gate ---------------------------------------------------------
# 113 Active rows are not forms: LITHO (39 of them), N/A, and two empties.
# A form number contains a digit; that single test drops all of them.
for junk in ['LITHO', 'N/A', '', '   ', 'MCIEAST-MCB CAMLEJ MCCS SPORT',
             'MCIEAST-MCB CAMLEJ/LSST-E/LEGA']:
    check(not fn.is_form_number(junk), f'{junk!r} must not pass the form-number gate')
for real in ['NAVMC 11620', 'DD 285', 'OPNAV 1650/3', 'NAVMC 118(11)', 'FHCC 118',
             'MCIWEST-MCB CAMPEN AC/S MCCS 12000/2']:  # 36 chars — the longest real one
    check(fn.is_form_number(real), f'{real!r} must pass the form-number gate')
# One Active row states an ordering instruction in the number field and passes
# every other gate. A form number is an identifier, not a sentence.
check(not fn.is_form_number('Please send email to: dd1898-forms.docsvcs@dla.mil to order'),
      'a prose instruction must not pass the form-number gate')

# --- titles ----------------------------------------------------------------
eq(fn.title_case('MAP EVALUATION'), 'MAP Evaluation', 'listed acronym kept')
eq(fn.title_case('UNIT PUNISHMENT BOOK'), 'Unit Punishment Book', 'plain words cased')
eq(fn.title_case('ADMINISTRATIVE ACTION'), 'Administrative Action', 'long words cased')
eq(fn.title_case('BCP/PFT EVALUATION'), 'BCP/PFT Evaluation', 'acronyms around a slash')
# The old rule was "all-caps and <=4 chars is an acronym", which shouted every
# short English word on the form. These are the words that exposed it.
for shouted in ['SIGN', 'OUT', 'UNIT', 'BOOK', 'DATE', 'NAME', 'TIME', 'FOR', 'USE', 'IN']:
    got = fn.title_case(shouted)
    check(got == shouted.capitalize(), f'{shouted!r} must not read as an acronym: got {got!r}')
eq(fn.title_case('CONTRAINDICATIONS FOR USE IN STEMI'),
   'Contraindications For Use In Stemi', 'unlisted acronym degrades to a word')
# 26 Active titles begin "U.S. …", and capitalize() lowercases everything after
# the first character, so the periods have to be split on and non-alphabetic
# parts left verbatim.
eq(fn.title_case('U.S. NAVY STANDARD INSTRUMENT DEPARTURE'),
   'U.S. Navy Standard Instrument Departure', 'U.S. keeps its shape')
eq(fn.title_case('MCO P1070.12K RECORD'), 'MCO P1070.12K Record',
   'alphanumeric parts are not re-cased')
eq(fn.title_case('PLACARD 8-1/2 X 11'), 'Placard 8-1/2 X 11', 'measurements untouched')

# --- rows the registry calls Active but that say they are dead -------------
# 38 Active numbers and 9 Active titles carry a cancellation notice in band.
for dead in ['NAVMC 11428 ***CANCELLED BY USMC***', 'ARMS 105 CANCELLED',
             'DD 1173 ***INACTIVE***', 'DD 3073 ***ON HOLD***',
             'NAVSO 10460/32 *CANCELED. EMAIL JFOLWAREHOUSE@DLA.MIL TO ORDER*',
             'NAVMC 10425 ***Cancelled per USMC Leadership***']:
    check(fn.is_retired(dead), f'{dead!r} must be recognized as retired')
# The notice sometimes sits only in the title.
check(fn.is_retired('DD 1934', '***CANCELLED BY DON***'), 'retired via title only')
check(fn.is_retired('DD 2MC (RES)', 'CANCELLED BY DON'), 'retired via unmarked title')
for live in ['NAVMC 11620', 'OPNAV 1650/3', 'NAVMED 5040*6', 'NAVMC 118(11)']:
    check(not fn.is_retired(live, 'MAP EVALUATION'), f'{live!r} must not read as retired')

# An asterisk that is part of the real number survives; a delimited annotation
# run does not.
eq(fn.folder_token('NAVMED 5040*6'), 'NAVMED50406', 'bare asterisk is part of the number')
eq(fn.folder_token('NAVMED 6710/*16'), 'NAVMED6710-16', 'asterisk inside a slashed number')
eq(fn.folder_token('NAVMC 11428 ***CANCELLED BY USMC***'), 'NAVMC11428',
   'asterisk-delimited notice stripped from the token')

# --- titles that are HTML, not text ---------------------------------------
# 33 Active rows store markup in formTitle and 52 more carry entities.
eq(fn.clean_title('<span style="font-family: Arial;">PARACHUTE LOG'), 'PARACHUTE LOG',
   'unclosed tag stripped')
eq(fn.clean_title('<span style="x">SALES SLIP - RECEIPTS</span>'), 'SALES SLIP - RECEIPTS',
   'wrapped title unwrapped')
eq(fn.clean_title('AUTO SERVICE &amp; REPAIR JOB SHEET'), 'AUTO SERVICE & REPAIR JOB SHEET',
   'entity unescaped')
eq(fn.clean_title('&lt;b&gt;PLACARD&lt;/b&gt;'), 'PLACARD', 'escaped tag unwrapped then stripped')
eq(fn.folder_name('AFTO FORM 394', '<span style="font-family: Arial;">PARACHUTE LOG'),
   'AFTOFORM394 - Parachute Log', 'markup never reaches the folder name')
# A title made only of markup is no title at all — the caller must be told to
# pass --folder rather than get a folder named after a style attribute.
check(not fn.has_title('<span style="font-family: Arial;"></span>'),
      'markup-only title must not count as a title')
check(not fn.has_title('   '), 'blank title must not count as a title')
check(fn.has_title('PARACHUTE LOG'), 'real title must count as a title')

# --- length cap ------------------------------------------------------------
long_title = ('CONTRAINDICATIONS FOR FIBRINOLYTIC USE IN STEMI CONSISTENT WITH '
              'ACCF AHA 2013 GUIDELINES AND FURTHER APPENDED GUIDANCE')
capped = fn.folder_name('NAVHOSPROTA 6320/89', long_title)
check(len(capped) <= fn.MAX_FOLDER, f'folder name not capped: {len(capped)} chars')
check(capped.startswith('NAVHOSPROTA6320-89 - '), f'token must survive the cap: {capped!r}')
check(not capped.endswith(('-', ' ', '.')), f'cap left a dangling separator: {capped!r}')
check(' ' in capped.split(' - ', 1)[1], 'cap should keep more than one word when it fits')
# The cap must hold even when the number token alone fills the budget. The
# guard was "room > 0 and too long", which skipped truncation in exactly this
# case and returned the untruncated title — a 182-character folder name.
for token_len in (fn.MAX_FOLDER - 3, fn.MAX_FOLDER, fn.MAX_FOLDER + 50):
    got = fn.folder_name('X' * token_len, long_title)
    check(len(got) <= max(token_len, fn.MAX_FOLDER),
          f'token of {token_len} chars produced a {len(got)}-char folder: {got!r}')
    check(' - ' not in got, f'no room for a title, so none should be appended: {got!r}')

# A form with no usable title degrades to the bare token rather than
# "NAVMC11036 -", the folder the empty-title bug actually produced.
eq(fn.folder_name('NAVMC 11036', ''), 'NAVMC11036', 'empty title -> bare token')
eq(fn.folder_name('NAVMC 11036', '   '), 'NAVMC11036', 'blank title -> bare token')

# --- ids and display names ------------------------------------------------
eq(fn.form_id('NAVMC11620 - MAP Evaluation'), 'navmc11620', 'id from folder')
eq(fn.form_id('OPNAV1650-3 - Award Recommendation'), 'opnav16503', 'id strips the dash')
eq(fn.form_id('NAVMC11811 - Administrative Remarks'), 'navmc11811', 'hand-built form id')

# The display number prefers the registry's own string: folder_token cannot be
# inverted ("OPNAV1650-3" could have been 1650/3 or 1650-3).
eq(fn.display_name('OPNAV1650-3 - Award Recommendation', 'OPNAV 1650/3'),
   'OPNAV 1650/3 - Award Recommendation', 'display uses the real number')
eq(fn.display_name('HQ-NRL5100-17 - Safety Report', 'HQ-NRL 5100/17 (REV. 10-91)'),
   'HQ-NRL 5100/17 - Safety Report', 'display drops the revision stamp')
# Fallback when the caller has no number: re-space the token (a heuristic).
eq(fn.display_name('NAVMC11620 - MAP Evaluation'), 'NAVMC 11620 - MAP Evaluation',
   'fallback re-spaces NAVMC')
eq(fn.display_name('NAVMCHQ029 - Reference Service Log'),
   'NAVMC HQ 029 - Reference Service Log', 'fallback handles NAVMC HQ')

if failures:
    print(f'FAIL — {len(failures)} assertion(s):')
    for f in failures:
        print(f'  - {f}')
    sys.exit(1)
print('OK — form-name derivation passed every observed-format assertion')
