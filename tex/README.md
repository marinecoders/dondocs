# LaTeX Templates Quick Reference

**Source:** SECNAV M-5216.5 CH-1 (DON Correspondence Manual, June 2015, Change 1 May 2018)

---

## Font Requirements

| Document Category | Font Size | Font Type | Source |
|-------------------|-----------|-----------|--------|
| **General Correspondence** (Chs 7-11) | 10-12pt *(REQUIRED)* | Times New Roman *(RECOMMENDED)*; Courier New *(permitted for informal only)* | Ch 2 ¶20 |
| **Executive Correspondence** (Ch 12) | 12pt *(REQUIRED)* | Times New Roman *(REQUIRED)* | Ch 12 ¶2, ¶2c, ¶3a(3) |

> **Ch 2 ¶20:** "For text, use 10 to 12 point font size. Times New Roman 12-point is the **preferred** font style and size for official correspondence, but Courier New may be used for informal correspondence."

---

## Text Formatting (Bold, Underline, Italics)

Per Ch 2 ¶20:

| Style | Usage | Restriction |
|-------|-------|-------------|
| **Bold** | Occasional emphasis | NOT for entire letters |
| **Underline** | Occasional emphasis; paragraph headings | NOT for entire letters |
| *Italics* | Occasional emphasis | NOT for entire letters |
| Script | Occasional emphasis | NOT for entire letters |

> "Bold, underline, script, and italics may be used for occasional emphasis, but not for entire letters."

### Paragraph Headings
Per Ch 7 ¶13d:
- **Underline** any heading
- **Capitalize** key words using Title Case format
- Be consistent: if paragraph 1 has a heading, paragraph 2 needs one too

---

## Body Text Rules

Per Ch 7 ¶12-13:

### Text Content
| Rule | Requirement | Source |
|------|-------------|--------|
| **Start position** | Second line below previous entry | Ch 7 ¶12 |
| **Justification** | LEFT ONLY (no right/center/full justify) | Ch 7 ¶12 |
| **Language** | Plain English, no slang or jargon | Ch 7 ¶12 |
| **Acronyms** | Spell out first use, then use acronym throughout | Ch 7 ¶12 |

### Paragraph Spacing
| Element | Requirement | Source |
|---------|-------------|--------|
| **Within paragraphs** | Single spaced | Ch 7 ¶13 |
| **Between paragraphs** | Double spaced (one blank line) | Ch 7 ¶13 |

### Subparagraph Indentation and Continuation Lines
Per Ch 7 ¶13:

> "When using a subparagraph, the first line is always indented the appropriate number of spaces depending on the level of subparagraphing. **All other lines of a subparagraph continue at the left margin. Do not indent the continuation lines of a subparagraph.**"

**Example (correct):**
```
    a. This is a subparagraph that continues to the next line.
    The continuation line returns to the left margin, not indented.
```

**Implementation:** The LaTeX template uses `itemindent` to push the first line (with label) right while keeping `leftmargin` at the continuation position. This ensures continuation lines automatically return to the label position per SECNAV requirements.

### Page Break Rules
Per Ch 7 ¶13:
- Do NOT start a paragraph at bottom of page unless **at least 2 lines** fit
- Carry over **at least 2 lines** to the next page
- **Signature page must have at least 2 lines of text** preceding signature

---

## Ink Color

### Signature Ink
Per Ch 2 ¶21:
- **Black or blue-black ink** only for signing correspondence *(REQUIRED)*

### Electronic Signatures / Signature Stamps
Per Ch 2 ¶6:
- Commanders/COs/OICs or civilian equivalents may authorize use of an electronic signature that replicates their signature where personal signing is impractical or the correspondence is routine
- Personnel authorized to use another person's signature stamp **shall pen their initials next to each signature they stamp** to authenticate it
- Safeguard signature stamps from unauthorized use

### Editing Ink (Suggested)
Per Ch 2 ¶21:
| Role | Color |
|------|-------|
| Activity Head | RED |
| Deputy/Executive Officer | GREEN |
| Heads of Administration | PURPLE |
| Heads of all other Departments | BLUE |

### Letterhead Ink
Per Appendix C ¶1d(6):
- **Blue (PMS 288)** for senior officials *(REQUIRED)*
- **Black** acceptable for others

### Envelope/Label Ink
Per Appendix C ¶4h:
- **Labels:** Black only
- **Envelopes:** Black or Blue (PMS 288)

---

## Margin Requirements by Document Type

| Document Type | Top Margin | Side Margins | Bottom Margin | Source |
|---------------|------------|--------------|---------------|--------|
| **Standard Naval Letter** | 1" (letterhead adds space) | 1" | 1" | Ch 7 ¶1 |
| **Business Letter** | 1" | 1" (up to 2" for short letters ≤100 words) | 1" | Ch 7 ¶1, Ch 11 Fig 11-6 |
| **Executive Memo (First Page)** | 2" (adjustable to 1.75"; 1" if no letterhead) | 1" (up to 2" if <11 lines) | 1" | Ch 12 ¶2b |
| **Executive Memo (Succeeding Pages)** | 1" | 1" | 1" | Ch 12 ¶2b |
| **Action Memo** | 1" | 1" | 1" | Ch 12 ¶3a(4) |
| **Directives** | 1" (header) | 1" | 0.5" (footer) | Ch 7 ¶1 (per OPNAVINST 5215.17) |

---

## Universal Requirements (All Documents)

| Element | Requirement | Status | Source |
|---------|-------------|--------|--------|
| **Paper** | 8.5" × 11" white bond | *REQUIRED* | Ch 2 ¶12 |
| **Margins (default)** | 1" all sides | *REQUIRED* | Ch 7 ¶1 |
| **Justification** | Left only (NO right/center/full justify) | *REQUIRED* | Ch 7 ¶1 |
| **Spacing** | Single within paragraphs, double between | *REQUIRED* | Ch 7 ¶13 |
| **Page Numbers** | First page: none; Second+: centered, 0.5" from bottom | *REQUIRED* | Ch 7 ¶17 |

---

## Colon Spacing After Headings

Per Ch 7 (various paragraphs):

| Heading | Spaces After Colon | Source |
|---------|-------------------|--------|
| `From:` | 2 spaces | Ch 7 ¶6c |
| `To:` | 6 spaces | Ch 7 ¶7b |
| `Via:` | 5 spaces | Ch 7 ¶8b |
| `Subj:` | 3 spaces | Ch 7 ¶9b |
| `Ref:` | 4 spaces | Ch 7 ¶10c |
| `Encl:` | 3 spaces | Ch 7 ¶11b |

**Second line alignment:** Start under the first word after the heading (not under the colon)

### "To:" Line Rules
Per Ch 7 ¶7a:
- Address all correspondence to the **activity head** of an activity
- Include the **office code** or person's title in parentheses, if known
- If office code is **only numbers**, add the word "Code" before the numbers (e.g., "Code 10")
- Do **NOT** add "Code" before an office code that starts with a letter (e.g., "N" or "SUP")
- **Avoid using the name of an individual** in the "To:" line — frequent turnover can result in misrouted mail
- You may include the complete mailing address and ZIP+4 code if you want the address for a record

---

## Subject Line Rules

Per Ch 7 ¶9:

| Rule | Requirement | Source |
|------|-------------|--------|
| Format | Sentence fragment, normal word order | Ch 7 ¶9a |
| Capitalization | **ALL CAPS** after colon | Ch 7 ¶9a |
| Acronyms | **DO NOT USE** in subject line | Ch 7 ¶9a |
| In text | Use **Title Case** when subject appears in body | Ch 7 ¶9a |
| Replies | Repeat incoming letter's subject exactly | Ch 7 ¶9a |
| Punctuation | No punctuation at end | Figure 7-1 |

**Example:**
```
Subj:   NORMAL WORD ORDER WITH ALL LETTERS CAPITALIZED AND NO PUNCTUATION
```

---

## Continuation Pages (Second and Later)

### Subject Line Repetition

| Document | What to Repeat | Position | Source |
|----------|----------------|----------|--------|
| **Naval Letter** | Subject line exactly | 6th line from top (1" margin), then text 2nd line below | Ch 7 ¶16 |
| **Business Letter** | Identification symbols (SSIC, Ser, Date) | 6th line from top, then text 2nd line below | Ch 11 ¶14 |
| **Endorsement** | Subject line (for new-page endorsements) | Per basic letter format | Ch 9 ¶2 |
| **Executive Memo** | Subject line | Per format | Ch 12, Fig 12-15 |

### Minimum Text Requirements
Per Ch 7 ¶13:
- Do NOT start a paragraph at bottom of page unless **at least 2 lines** fit on that page
- Carry over **at least 2 lines** to the next page
- **Signature page must have at least 2 lines of text** preceding signature

---

## Page Numbering

Per Ch 7 ¶17, Ch 11 ¶15:

| Page | Format | Position | Source |
|------|--------|----------|--------|
| First page | **NOT numbered** | — | Ch 7 ¶17 |
| Second+ pages | Arabic numeral only (2, 3, 4...) | Centered, 0.5" from bottom edge | Ch 7 ¶17 |
| Punctuation | **NONE** (no period, dash, or "Page") | — | Ch 7 ¶17 |

### Executive Memo Page Numbers
Per Ch 12 ¶2g, two options:
1. **Top right:** 1" from top, at right margin; text continues triple space below
2. **Bottom center:** At least double space below text, 1" from bottom

---

## Enclosure Rules

### Enclosure Line Format
Per Ch 7 ¶11:

```
Encl:   (1) Title of First Enclosure
        (2) Title of Second Enclosure (sep cover)
```

| Rule | Requirement | Source |
|------|-------------|--------|
| Position | Left margin, 2nd line below previous heading | Ch 7 ¶11b |
| Spacing | 3 spaces after colon | Ch 7 ¶11b |
| Numbering | Always use parenthetical numbers, even for single enclosure: `(1)` | Ch 7 ¶11b |
| Order | List in order they appear in text | Ch 7 ¶11a |
| Never duplicate | Never list item in both enclosure AND reference line | Ch 7 ¶11a |

### Marking Enclosures
Per Ch 2 ¶13a:

| Page | Marking | Position |
|------|---------|----------|
| First page | `Enclosure (1)` | Lower right corner, right justified |
| Succeeding pages | `Enclosure (1)` then page number centered 2 lines below | Lower right corner |

**Example (succeeding page):**
```
                                                    Enclosure (1)
                                                         2
```

### Enclosure Page Numbering
Per Ch 2 ¶13b:
- Number only **second and later pages**
- Number pages of **each enclosure independently**

### Separate Cover
Per Ch 2 ¶13c, Ch 7 ¶11g:
- When enclosure cannot be sent with letter: `(sep cover)` after description
- Example: `Encl: (1) SECNAVINST 5211.5E (sep cover)`

### Multiple Copies to All Addressees
Per Ch 7 ¶11d:
```
Encl: (1) OPNAV 5216/10 (10 Copies)
```

### Varying Distribution to Copy To Addressees
Per Ch 7 ¶11e:

**All Copy To affected:**
```
Copy to: (w/o encls)
Copy to: (w/o encls (2) and (3))
Copy to: (w/2 copies of encl (1))
```

**Only some Copy To affected:**
```
Copy to:
COMNAVSURFPAC (N1) (w/o encls)
USS MUSTIN (w/encl (2) only)
USS VANDERGRIFT
```

### Varying Distribution to Via Addressees
Per Ch 7 ¶11f:
```
Via: Commanding Officer, Naval Technical Training Center, Meridian (w/o encl)
```

### Business Letter Enclosures
Per Ch 11 ¶10:
- Use `Enclosures:` (not `Encl:`)
- Position: 2nd line below signature line
- Format: `Enclosures: 1. GPO Style Manual`
- If insignificant: `Enclosures (2)` (number only, no description)

### What Can Be an Enclosure
Per Ch 2 ¶13:
- Manuals, publications, photocopies of correspondence, charts, etc. **belonging to the specific DON organization only**
- **NO external documents** — consider making them references instead

---

## Serial Number and SSIC Rules

### SSIC (Standard Subject Identification Code)
Per Ch 7 ¶3a(1):
- 4- or 5-digit number representing document's subject
- **Required** on all Navy and Marine Corps messages, directives, forms, and reports
- Reference: SECNAV M-5210.2

### Serial Number Format
Per Ch 7 ¶3a(2):

**Without serial number:**
```
5216
Code 13
```

**With serial number (unclassified):**
```
5216
Ser Code 13/271
7 Sep 06
```

**With serial number (classified):**
```
5216
Ser N00J/S20
```
Format: `Ser [originator code]/[classification initial][serial number]`
- Classification initials: FOUO, C (Confidential), S (Secret), TS (Top Secret)

### Serial Number Rules
Per Ch 7 ¶3a(2)(b):
- **Classified correspondence:** Serial number *(REQUIRED)*
- **Unclassified correspondence:** Serial number *(OPTIONAL)* — depends on local practice
- Start new sequence at beginning of each calendar year
- Assign consecutively beginning with **001**

---

## Abbreviations and Acronyms

Per Ch 2 ¶17:

| Rule | Requirement | Source |
|------|-------------|--------|
| First use | Spell out, then acronym in parentheses | Ch 2 ¶17c |
| Subject line | **DO NOT USE** acronyms | Ch 7 ¶9a |
| Directives | Every acronym must be identified, no matter how well known | Ch 2 ¶17a |
| Press reports | Do not abbreviate military titles | Ch 2 ¶17b |
| Established | "Mr.", "Ms.", "e.g.", "i.e." acceptable without definition | Ch 2 ¶17a |

**Example:**
```
FIRST USE:  The North Atlantic Treaty Organization (NATO) held a meeting.
SECOND USE: The NATO is holding a meeting in March.
```

---

## Capitalization Rules

| Element | Capitalization | Source |
|---------|---------------|--------|
| Subject line | ALL CAPS | Ch 7 ¶9a |
| Last name (signature) | ALL CAPS (except prefix: McNALLY) | Ch 7 ¶14a(1) |
| Last name (in text) | Normal case (NOT all caps) | Ch 2 ¶10 |
| "Sailor", "Marine", "Service Member" | Capitalize when referring to USN/USMC | Ch 2 ¶10 |
| Paragraph headings | Title Case, underlined | Ch 7 ¶13d |
| Salutation (business letter) | First letter of first word + courtesy title + surname | Ch 11 ¶4 |
| Delivery address (envelope) | ALL CAPS (uppercase) | Ch 6 ¶3a(2) |

---

## Date Formats

| Format | Use | Example | Source |
|--------|-----|---------|--------|
| **Abbreviated** | Sender's symbol only | `15 Feb 09` | Ch 2 ¶16a |
| **Standard** | Text of military correspondence | `5 May 2015` | Ch 2 ¶16b |
| **Civilian** | Business letters (date line AND text) | `January 14, 2014` | Ch 2 ¶16c, Ch 11 ¶1c |

**Rules:**
- Do NOT use zero before single digit day (use `5 May`, not `05 May`)
- Abbreviated format: 1-2 digit day + 3-letter month + 2-digit year
- Standard format: 1-2 digit day + spelled month + 4-digit year
- Civilian format: Spelled month + day + comma + 4-digit year

---

## Military Time

Per Ch 2 ¶15:
- Range: 0000 to 2359
- First two digits = hour after midnight
- Last two digits = minutes
- **Do NOT use a colon** to separate hour from minutes

**Example:** 6:30 am civilian = `0630` military

---

## Paragraph Structure (8 Levels Max)

Per Ch 7 ¶13, Figure 7-8. Indentation aligns with first letter of text above.

| Level | Label | Indent Rule |
|-------|-------|-------------|
| 1 | `1.` | Left margin |
| 2 | `a.` | Align with first letter of level 1 text |
| 3 | `(1)` | Align with first letter of level 2 text |
| 4 | `(a)` | Align with first letter of level 3 text |
| 5 | `1.` *(underlined)* | Align with first letter of level 4 text |
| 6 | `a.` *(underlined)* | Align with first letter of level 5 text |
| 7 | `(1)` *(underlined)* | Align with first letter of level 6 text |
| 8 | `(a)` *(underlined)* | Align with first letter of level 7 text |

**Rules:**
- "If subparagraphs are needed, use at least two; e.g., a (1) must have a (2)" — *Ch 7 ¶13, Figure 7-8*
- "Do not subparagraph past [level 4] until you have exhausted all re-paragraphing alternatives" — *Ch 7 ¶13b*
- "Never subparagraph beyond [level 8]" — *Figure 7-8*
- Continuation lines return to left margin — *Ch 7 ¶13*
- **Do NOT indent continuation lines of a subparagraph** — *Ch 7 ¶13*

### Citing Paragraphs
Per Ch 7 ¶13c:
- Write numbers and letters **without periods or spaces**
- Example: `2b(4)(a)`

---

## Document Types

### Standard Naval Letter
- **Chapter:** 7
- **Letterhead:** YES *(REQUIRED)* — *Ch 7 ¶1, Figures 7-1, 7-2*
- **Margins:** 1" all sides *(REQUIRED)* — *Ch 7 ¶1*
- **Numbered Paragraphs:** YES (8 levels) *(REQUIRED)* — *Ch 7 ¶13, Figure 7-8*
- **From/To Lines:** YES *(REQUIRED)* — *Ch 7 ¶6, ¶7*
- **Signature:** Center of page, 4th line below text. Preferred format: first initial, middle initial, and last name (e.g., J. M. SMITH). If no middle name, use first initial and last name only. Last name in ALL CAPS (exception: prefixes like McNALLY). Signature lines may be changed based on signer's preference. NO rank, NO complimentary close *(REQUIRED)* — *Ch 7 ¶14a(2)*
- **"By direction" Signature:** When a subordinate is formally authorized to sign, type "By direction" below the name (not below the title). When the correspondence affects pay and allowances, include (a) name, (b) title, and (c) "By direction of the [activity head]." — *Ch 7 ¶14b(4)-(5)*
- **"Acting" Signature:** When an officer temporarily succeeds to command, type "Acting" below the name. When formally appointed to replace an official who signs by title, type "Acting" below the typed name — *Ch 7 ¶14b(3), Ch 2 ¶5d*
- **Signing "For" an Absent Official:** When the regular signer is unavailable and a delay would fail to meet a deadline, a delegated authority may sign and hand-write "for" before the typed name — *Ch 2 ¶5e*
- **Stamp Signatures:** If using a stamp, mark all copies and avoid smeared or crooked impressions — *Ch 7 ¶14a(2)*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20, Ch 7 ¶2*

### Business Letter
- **Chapter:** 11
- **Letterhead:** YES *(REQUIRED)* — *Ch 11 ¶13, Figures 11-2, 11-3*
- **Margins:** 1" all sides; up to 2" sides for short letters (≤100 words) — *Ch 7 ¶1, Ch 11 Figure 11-6*
- **Numbered Paragraphs:** NO *(REQUIRED)* — *Ch 11 ¶6: "Do not number main paragraphs"*
- **Paragraph Indent:** "four spaces (or set margin at half inch)" *(REQUIRED)* — *Ch 11 ¶6*
- **Subparagraph Indent:** "eight spaces and start typing at the ninth space" — *Figure 11-1*
- **Inside Address:** Place two to eight lines below the date (more space for short letters ≤100 words). City, state, and ZIP+4 code on last line with **only one space** between state and ZIP code — *Ch 11 ¶2, ¶2a(5), Figure 11-6*
- **Date Format:** Spelled out (January 5, 2015) *(REQUIRED)* — *Ch 11 ¶1c*
- **Attention Line:** Place 2 lines below last line of inside address and 2 lines above the salutation; type "Attention:" followed by name or title. Salutation must agree with first line of address (use collective salutation like "Ladies and Gentlemen" if addressing an organization) — *Ch 11 ¶3, Figure 11-5*
- **Salutation:** YES, followed by colon *(REQUIRED)* — *Ch 11 ¶4*
- **Subject Line:** Optional; may replace the salutation. When used in place of salutation, the first sentence serves as a greeting to the reader — *Ch 11 ¶5, Figure 11-4*
- **Complimentary Close:** YES ("Sincerely,") at center, 2nd line below text *(REQUIRED)* — *Ch 11 ¶8*
- **Signature:** Center of page, 4th line below "Sincerely,"; includes name (ALL CAPS), rank (spelled out), title, authority line — *Ch 11 ¶9a*
- **Authority Line:** May be omitted on a routine business letter that neither makes a commitment nor takes an official stand — *Ch 11 ¶9a(4)*
- **Short Letter Spacing:** In a letter containing eight lines or less, you may double-space throughout the text — *Ch 11 ¶6, Figure 11-6*
- **Separate Mailing:** When an enclosure is to be sent separately, type "Separate Mailing:" and a brief description (e.g., `Separate Mailing: SECNAV M-5216.5`) — *Ch 11 ¶11*
- **References/Enclosures:** "in the body of the letter only, without calling them references or enclosures" *(REQUIRED)* — *Ch 11 ¶7*
- **Outgoing Copies:** Because the business letter has no "From:" line, every copy sent to addressees outside your activity must be a letterhead copy (printed, typed, stamped, or reproduced from the original) to show its origin — *Ch 11 ¶13*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Letterhead Memorandum
- **Chapter:** Ch 10 ¶4
- **Letterhead:** YES *(REQUIRED)* — *Figure 10-4*
- **Use:** "within your activity...routine matters that neither make a commitment nor take an official stand" — *Ch 10 ¶4*
- **Format:** Same as Standard Naval Letter, with "MEMORANDUM" typed below sender's symbols — *Ch 10 ¶4*
- **Signature:** Full signature line NOT required ("From:" line identifies signer) — *Ch 10 ¶4*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Memorandum for the Record (MFR)
- **Chapter:** Ch 10 ¶1
- **Letterhead:** NOT REQUIRED (plain paper acceptable) — *Figure 10-1*
- **Numbered Paragraphs:** YES (8 levels) — *Ch 10 ¶1*
- **SSIC:** NOT REQUIRED — *Ch 10 ¶1: "identification symbols are not required"*
- **Signature:** Full signature line NOT required; must be "dated, signed, and show the organizational position of the signer" — *Ch 10 ¶1*
- **Use:** "record supporting information...documenting the results of a meeting, an important telephone conversation, or an oral agreement" — *Ch 10 ¶1*
- **May be handwritten** — *Ch 10 ¶1*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### From-To Memorandum
- **Chapter:** Ch 10 ¶2
- **Forms:** OPNAV 5215/144A (8-1/2 x 11) or OPNAV 5215/144B (8-1/2 x 5-1/2) — *Ch 10 ¶2*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Plain-Paper Memorandum
- **Chapter:** Ch 10 ¶3
- **Date Position:** "Type the date on the sixth line so it ends flush with the right margin" — *Ch 10 ¶3b*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Joint Letter / Joint Memorandum
- **Chapter:** Ch 7 (Figure 7-4)
- **Letterhead:** Dual (both commands) *(REQUIRED)* — *Figure 7-4*
- **Numbered Paragraphs:** YES (8 levels) *(REQUIRED)* — *Ch 7 ¶13*
- **Signature Order:** "Arrange signature lines so the senior official is at the right. ...The senior official signs the letter last." *(REQUIRED)* — *Figure 7-4*
- **Third Cosigner:** "Place the signature line of a third cosigner in the middle of the page" — *Figure 7-4*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### MOA / MOU (Memorandum of Agreement/Understanding)
- **Chapter:** Ch 10 ¶6
- **Letterhead:** Both commands or plain bond; "type the command titles so the senior is at the top" *(REQUIRED)* — *Ch 10 ¶6c*
- **Heading Format:** Center "MEMORANDUM OF AGREEMENT" (or "UNDERSTANDING") on the second line below the date line. Center "BETWEEN" on the next line, followed by the names of the agreeing activities. For MOU, substitute "Understanding" for "Agreement" — *Ch 10 ¶6b*
- **Numbered Paragraphs:** YES (8 levels) "the same as other correspondence" *(REQUIRED)* — *Ch 10 ¶6b*
- **Signature:** "Precede all signature lines by over scoring" (line above name) *(REQUIRED)* — *Ch 10 ¶6d*
- **Signature Order:** "senior official is at the right...senior activity should sign the agreement after the junior activity(ies)" *(REQUIRED)* — *Ch 10 ¶6d*
- **Third Cosigner:** "Place the signature line of a third cosigner in the middle of the page" — *Ch 10 ¶6d*
- **Copies:** "The activity signing last should send copies of the agreement to all cosigners" — *Ch 10 ¶6e*
- **Standard Paragraphs:** Purpose, Problem, Scope, Agreement/Understanding, Effective Date — *Ch 10 ¶6b*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Endorsement (Same-Page)
- **Chapter:** Ch 9
- **Letterhead:** N/A (continues on basic letter's signature page) — *Figure 9-1*
- **When to Use:** "If it will completely fit on the signature page of the basic letter or the preceding endorsement" — *Ch 9 ¶1*
- **Numbered Paragraphs:** NO (continues basic letter sequence) — *Ch 9 ¶1a*
- **May Omit:** SSIC, subject, basic letter's identification symbols "if the entire page will be photocopied" — *Ch 9 ¶1a*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Endorsement (New-Page)
- **Chapter:** Ch 9
- **Letterhead:** YES *(REQUIRED)* — *Figure 9-2*
- **Must Include:** SSIC, subject line (repeat from basic letter exactly), basic letter identification — *Ch 9 ¶2, Figure 9-2*
- **Endorsement Line Format:** "FIRST ENDORSEMENT on [basic letter reference]" — *Ch 9 ¶1b*
- **Endorsement Numbering:** Use ordinal numbers: FIRST, SECOND, THIRD, etc. Number each endorsement in sequence as it is added to the basic letter — *Ch 9 ¶1b*
- **Heading Overflow:** When the endorsement heading exceeds one line, start the succeeding line with the word "on" — *Ch 9 ¶1b*
- **Numbered Paragraphs:** NO (continues basic letter sequence) — *Ch 9 ¶1*
- **"Via:" Line in Endorsements:** Include any remaining "Via" addressees. If only one remains, do not number it. If more than one remains, number starting with (1) — *Ch 9 ¶2*
- **Adding References:** Continue sequence from basic letter (if basic had up to (f), start with (g)) — *Ch 9 ¶3*
- **Adding Enclosures:** Continue sequence from basic letter (if basic had up to (5), start with (6)) — *Ch 9 ¶4*
- **Copy To in Endorsements:** If endorsement is significant (recommending disapproval, readdressed, substantive comments), include prior endorsers and the originator of the basic letter as copy to addressees. All copy to addressees from the basic letter and previous endorsements also become copy to addressees — *Ch 9 ¶5*
- **"(complete)" Notation:** When a copy to addressee receives the basic letter and previous endorsements for the first time from you, type "(complete)" in parentheses to the right of their name — *Ch 9 ¶6c*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

### Multiple-Address Letter
- **Chapter:** Ch 8
- **Letterhead:** YES *(REQUIRED)* — *Figures 8-1, 8-2, 8-3*
- **Numbered Paragraphs:** YES (8 levels) *(REQUIRED)* — *Ch 7 ¶13*
- **Listing Addressees:** — *Ch 8 ¶2*
  - ≤4 addressees: Use "To:" line only — *Ch 8 ¶2(1), Figure 8-1*
  - >4 addressees: Omit "To:" line, use "Distribution:" line only — *Ch 8 ¶2(2), Figure 8-2*
  - Group title: Use both "To:" and "Distribution:" — *Ch 8 ¶2(3), Figure 8-3*
- **Font:** 10-12pt *(REQUIRED)*, Times New Roman *(RECOMMENDED)* — *Ch 2 ¶20*

---

## Executive Correspondence (HqDON/OSD) — Chapter 12

**All Executive Correspondence:** Times New Roman 12pt *(REQUIRED)* — *Ch 12 ¶2, ¶2c*

### Standard Memorandum (HqDON)
- **Margins (First Page):** 2" top (adjustable to 1.75"; 1" if no letterhead), 1" sides and bottom — *Ch 12 ¶2b*
- **Margins (Succeeding Pages):** 1" all sides — *Ch 12 ¶2b*
- **Margins (<11 lines):** Side margins may increase to 2" — *Ch 12 ¶2b*
- **Paragraph Indent:** 0.5" from left margin — *Ch 12 ¶2e*
- **Subparagraph Indent:** Additional 0.5" — *Ch 12 ¶2e*
- **Subparagraph Style:** "bullets, numbers, or lower-case letters" — *Ch 12 ¶2f*
- **Spacing:** Single within paragraphs, double between paragraphs and bullets. Exception: memorandums with a single paragraph of eight lines or less may be double-spaced throughout — *Ch 12 ¶2d*
- **Address Line (MEMORANDUM FOR):** Double space below date line. For single addressee, include title and office symbol. If multi-line, indent second line 2 additional spaces so first character aligns below third character of addressee title above. For multiple addressees, type each on a single line in block style below and to the right of "MEMORANDUM FOR:". If >16 addressees, use "MEMORANDUM FOR: SEE DISTRIBUTION" and add DISTRIBUTION list after signature block — *Ch 12 ¶2i*
- **ATTN: Line:** Type "ATTN:" followed by name or title in parentheses, placed single space below address line, aligned under third character of office address — *Ch 12 ¶2j*
- **THROUGH: Line:** Type "THROUGH:" double space below address line and double space above subject line. Type the "THROUGH:" office in ALL CAPS. Avoid using THROUGH when addressing to SecDef, DepSecDef, SECNAV, or UNSECNAV — *Ch 12 ¶2k*
- **Subject Line:** Type "SUBJECT:" double space below last line of address line. Two spaces after colon. Capitalize first word and all principal words (Title Case, NOT ALL CAPS). Multi-line subjects: succeeding lines aligned below first word in subject line — *Ch 12 ¶2l*
- **References:** Avoid for SecDef/DepSecDef/ExecSec signature. Do not letter a reference when there is only one (use "Reference:" not "Reference: (a)"). Multiple references: use "References:" with (a), (b), (c), etc. Attached references: add "(copy attached)" after title. Classified references: indicate classification of TITLE in parentheses BEFORE the title, and classification of REFERENCE at END — *Ch 12 ¶2m*
- **Body Text:** Begin two lines below subject line. Use active voice and clear conversational language. Convey the message in complete, succinct paragraphs; restrict to 10-15 lines. Present most important information first — *Ch 12 ¶2o*
- **Salutation:** NO — *Ch 12 ¶2n*
- **Complimentary Close:** NO — *Ch 12 ¶2p*
- **Signature Block:** Omit for SecDef/DepSecDef; full name for SECNAV/UNSECNAV; standard for others — *Ch 12 ¶2q*
- **Signature Stamping:** The signer's name and title may be stamped below the written signature — *Ch 12 ¶2q(4)*
- **Dual/Multiple Signatures:** When SecDef/DepSecDef/SECNAV/UNSECNAV and head of another agency co-sign, place signature blocks side by side with 4 blank lines below text. Non-DoD official at left margin; SecDef/DepSecDef/SECNAV/UNSECNAV beginning at center. When officials from 2+ offices sign, originating official's signature block on right side, additional co-signers to left and below — *Ch 12 ¶2q(5)*
- **Date:** Omit for SecDef/DepSecDef/ExecSec signature (added when signed) — *Ch 12 ¶2h*
- **Page Numbers:** Either top right (1" from top) or bottom center (1" from bottom) — *Ch 12 ¶2g*

### Action Memorandum
- **Use:** "Forwarding material that requires SecDef, DepSecDef, HqDON approval or signature" or "Describing a problem and recommending a solution" — *Ch 12 ¶1b(2)*
- **Margins:** 1" all sides *(REQUIRED)* — *Ch 12 ¶3a(4)*
- **Length:** "Limit to one page, unless issue is complex" — *Ch 12 ¶3a(1)*
- **Style:** "short, concise and clear bullet statements (use of black dot bullet preferred)" — *Ch 12 ¶3a(2)*
- **Page Numbering:** Number pages at bottom center starting on page 2 — *Ch 12 ¶3a(7)*
- **Required Elements:** FOR:, FROM:, SUBJECT:, bullets, RECOMMENDATION:, COORDINATION:, Attachments:, Prepared By: — *Figure 12-9*

### Information Memorandum
- **Use:** "convey information...on important developments not requiring action" — *Ch 12 ¶1b(3)*
- **Header:** "INFO MEMO" centered, **bold**, all caps — *Ch 12 ¶4a(1)*
- **Signature Block:** NONE; "sending official signs and dates on the 'FROM' line" — *Ch 12 ¶4a(3), (7)*
- **Required Elements:** FOR:, FROM: (with signature), SUBJECT:, bullets, COORDINATION:, Attachments:, Prepared By: — *Figure 12-11*

### Decision Memorandum
- **Use:** "only requesting an approval/disapproval decision from a single addressee" — *Ch 10 ¶5*
- **Decision Block:** At left margin, two lines below signature line — *Ch 10 ¶5*
- **Format:**
  ```
  COMMANDING OFFICER DECISION:
  _____________________ Approved
  _____________________ Disapproved
  _____________________ Other
  ```

---

## Quick Comparison Table

| Document | Numbered Para | From/To | Salutation | Complimentary Close | Signature Style | Source |
|----------|---------------|---------|------------|---------------------|-----------------|--------|
| Naval Letter | YES | YES | NO | NO | Abbreviated name only | Ch 7 |
| Business Letter | **NO** (indent 0.5") | NO | YES (+ colon) | YES ("Sincerely,") | Full name, rank, title | Ch 11 |
| Endorsement | NO* | YES | NO | NO | Abbreviated name | Ch 9 |
| MOA/MOU | YES | NO | NO | NO | Overscored full name | Ch 10 ¶6 |
| Joint Letter | YES | YES | NO | NO | Dual signatures, senior RIGHT | Ch 7, Fig 7-4 |
| Exec Standard Memo | YES (bullets OK) | YES | NO | NO | Varies by signer | Ch 12 ¶2 |
| Action Memo | Bullets | YES | NO | NO | None (for principals) | Ch 12 ¶3 |
| Info Memo | Bullets | YES (signed) | NO | NO | None (sign FROM line) | Ch 12 ¶4 |

*Endorsements continue the basic letter's paragraph sequence

---

## Signature Block Position

| Document | Position | Source |
|----------|----------|--------|
| **Naval Letter** | Center of page, 4th line below text | Ch 7 ¶14a(2) |
| **Business Letter** | Center, 4th line below "Sincerely," | Ch 11 ¶9a |
| **MOA/MOU** | Dual columns, overscored, senior RIGHT | Ch 10 ¶6d, Figures 10-5, 10-7 |
| **Executive Memo** | Center, 4 blank lines below text (omit for SecDef/DepSecDef) | Ch 12 ¶2q |

---

## Element Positioning by Document Type

This section documents the horizontal position of every major element for each document type, as implemented in the LaTeX templates.

### Standard Naval Letter (`naval_letter.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **SSIC / Serial / Date** | Right-aligned (flush right margin) | `\raggedleft` | Ch 7 §3: "longest line should end close to the right margin" |
| **From / To / Via** | Left margin | `\noindent` tabular | Ch 7 ¶6-8, Figure 7-1 |
| **Subj / Ref / Encl** | Left margin (text indented per colon spacing) | `\noindent` tabular | Ch 7 ¶9-11 |
| **Body text** | Left margin, left-justified | `\noindent` | Ch 7 ¶12 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 7 ¶14a(2) |
| **Copy to** | Left margin | `\noindent` | Ch 7 ¶15 |

### Standard Letter (`standard_letter.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **SSIC / Serial / Date** | Right-aligned (flush right margin) | `\raggedleft` | Ch 7 §3 |
| **From / To / Via / Subj** | Left margin | `\noindent` tabular | Ch 2 ¶1.c.(1) |
| **Body text** | Left margin | `\noindent` | Ch 7 ¶12 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 7 ¶14a |
| **Copy to** | Left margin | `\noindent` | Ch 7 ¶15 |

### Business Letter (`business_letter.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **SSIC / Serial / Date** | Upper LEFT corner, blocked | `\noindent` tabular (left-aligned) | Ch 11 ¶1 |
| **Inside address** | Left margin | `\noindent` | Ch 11 ¶2 |
| **Attention line** | Left margin | `\noindent` | Ch 11 ¶3 |
| **Salutation** | Left margin | `\noindent` | Ch 11 ¶4 |
| **Subject** | Left margin | `\noindent` | Ch 11 ¶5 |
| **Body text** | Indented 0.5" (4 spaces) | `\parindent{0.5in}` | Ch 11 ¶6 |
| **Complimentary close** | Centered | `\begin{center}` | Ch 11 ¶8 |
| **Signature block** | Centered | `\begin{center}` + minipage | Ch 11 ¶9a |
| **Enclosures** | Left margin | `\noindent` | Ch 11 ¶10 |
| **Copy to** | Left margin | `\noindent` | Ch 11 ¶15 |

### Multiple Address Letter (`multiple_address_letter.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **SSIC / Serial / Date** | Right-aligned | `\hfill` + tabular | Ch 7 §3 |
| **From / To / Via / Subj** | Left margin | `\noindent` tabular | Ch 8, Figures 8-1 to 8-3 |
| **Body text** | Left margin | `\noindent` | Ch 7 ¶12 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 7 ¶14a |
| **Copy to / Distribution** | Left margin | `\noindent` | Ch 8 ¶2 |

### MOA / MOU (`moa.tex`, `mou.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **Dual SSIC blocks** | Side by side (senior LEFT, junior RIGHT) | Dual-column tabular | Ch 10 ¶6c |
| **Title block** | Centered ("MEMORANDUM OF AGREEMENT / BETWEEN / ...") | `\begin{center}` | Ch 10 ¶6b |
| **Subj** | Left margin | `\noindent` tabular | Ch 10 ¶6 |
| **Body text** | Left margin | `\noindent` | Ch 10 ¶6b |
| **Dual signatures** | Side by side (junior LEFT, senior RIGHT), overscored | Dual-column tabular | Ch 10 ¶6d |

### Joint Letter / Joint Memorandum (`joint_letter.tex`, `joint_memorandum.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **Dual SSIC blocks** | Side by side (senior LEFT, junior RIGHT) | Dual-column tabular | Figure 7-4 |
| **From / To / Via / Subj** | Left margin | `\noindent` tabular | Ch 7, Figure 7-4 |
| **Body text** | Left margin | `\noindent` | Ch 7 ¶12 |
| **Dual signatures** | Side by side (junior LEFT, senior RIGHT) | Dual-column tabular | Figure 7-4 |

### Executive Memorandums (`standard_memorandum.tex`, `action_memorandum.tex`, `information_memorandum.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **Date** | Right-aligned | `\hfill` | Ch 12 ¶2h |
| **MEMORANDUM FOR** | Left margin | `\noindent` | Ch 12 ¶2i |
| **FROM / SUBJECT** | Left margin (tabular) | `\noindent` tabular | Ch 12 ¶2l |
| **Body text** | Indented 0.5" | Per Ch 12 ¶2e | Ch 12 ¶2e |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 12 ¶2q |

### Executive Correspondence (`executive_correspondence.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **Date** | Right-aligned | `\hfill` | Ch 12 ¶2h |
| **Recipient address** | Left margin | `\noindent` | Ch 12 |
| **Salutation** | Left margin | `\noindent` | Ch 12 ¶4 |
| **Body text** | Indented 0.5" | `\parindent{0.5in}` | Ch 12 ¶2e |
| **Complimentary close** | Center of page | `\hspace{3.25in}` | Ch 12 ¶4 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 12 ¶2q |

### Endorsements (`same_page_endorsement.tex`, `new_page_endorsement.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **SSIC / Serial / Date** | Right-aligned | `\hfill` + tabular | Ch 9, Ch 7 §3 |
| **Endorsement heading** | Left margin | `\noindent` | Ch 9 ¶1b |
| **From / To / Via / Subj** | Left margin | `\noindent` tabular | Ch 9 ¶2 |
| **Body text** | Left margin | `\noindent` | Ch 9 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 7 ¶14a |
| **Copy to** | Left margin | `\noindent` | Ch 9 ¶5 |

### Memorandum Formats (`letterhead_memorandum.tex`, `plain_paper_memorandum.tex`, `mfr.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **SSIC / Date** | Right-aligned | `\hfill` | Ch 10 ¶3-4 |
| **MEMORANDUM label** | Left margin (for letterhead memo) | `\noindent` | Ch 10 ¶4 |
| **From / To / Via / Subj** | Left margin | `\noindent` tabular | Ch 10 |
| **Body text** | Left margin | `\noindent` | Ch 10 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 7 ¶14a |

### Decision Memorandum (`decision_memorandum.tex`)

| Element | Position | LaTeX Implementation | Source |
|---------|----------|---------------------|--------|
| **Date** | Right-aligned | `\hfill` | Ch 10 ¶5 |
| **MEMORANDUM FOR** | Left margin | `\noindent` | Ch 10 ¶5 |
| **SUBJECT** | Left margin | `\noindent` tabular | Ch 10 ¶5 |
| **Body text** | Left margin | `\noindent` | Ch 10 ¶5 |
| **Signature block** | Center of page | `\hspace{3.25in}` + minipage | Ch 10 ¶5 |
| **Decision block** | Left margin, 2 lines below signature | `\noindent` | Ch 10 ¶5 |

### Positioning Summary

| Element | Standard Position | Exceptions |
|---------|-------------------|------------|
| **SSIC / Serial / Date** | Right-aligned (`\raggedleft` or `\hfill`) | Business Letter: upper LEFT; MOA/MOU/Joint: dual columns |
| **From / To / Via / Subj** | Left margin | Executive memos: use MEMORANDUM FOR instead |
| **Body text** | Left margin, left-justified | Business Letter & Executive: indented 0.5" |
| **Signature block** | Center of page (`\hspace{3.25in}`) | MOA/MOU/Joint: dual columns; Business Letter: centered (`\begin{center}`) |
| **Copy to** | Left margin | — |
| **Page numbers** | First page: none; Page 2+: bottom center | Executive: may use top right |

---

## Reference Line Formats

Per Ch 7 ¶10d:

| Type | Format | Example |
|------|--------|---------|
| Naval correspondence | SNDL short title + ltr/memo + SSIC + Ser + date | `COMSUBGRU TWO ltr 7200 Ser N1/123 of 12 Mar 08` |
| Business letter | Company name + ltr + date | `Smith Widget Co. ltr of 14 Oct 05` |
| E-mail | SNDL + e-mail + ltr/memo + SSIC + Ser + date | `OPNAV e-mail ltr 5216 Ser N4/158 of 21 Sep 06` |
| Message | Originator PLA + DTG | `USS PORTER 071300Z Mar 15` |
| Instruction | SNDL short title + INST + SSIC | `SECNAVINST 7510.1` |
| Notice | SNDL + NOTE + SSIC + Ser + date + (Canc: date) | `OPNAVNOTE 5216 Ser 09B/xxx of 21 May 08 (Canc: May 09)` |
| U.S. Code | Title + U.S.C. + § + section | `28 U.S.C. §1498` |
| DoD Directive/Instruction | Short title + number + date (month spelled out) | `DoD Directive 2000.1 of 6 May 2006` |
| Telephone conversation | PHONCON + activity SNDL short title + office code + individual name + date | `PHONCON NAVPGSCOL, Code 13, CDR Smith, 3/15/08` |
| Meeting | Mtg + activity SNDL short title + office code + individual name + date | `Mtg NAVPGSCOL, Code 13, CDR Smith, 3/15/08` |
| Undated correspondence | Add `(undated)` | `CNO memo 5216 Ser 09B33/6U317731 (undated)` |

**Reference Overflow:** If more than 26 references, continue with (aa), (ab), (ac), etc. — *Ch 7 ¶10c*

**NOTAL Reference:** If addressee doesn't have reference, add `(NOTAL)` after it — *Ch 7 ¶10b*

---

## Classification Markings

Per DoDM 5200.01 Vol 2-4 (referenced in Ch 7 ¶4-5):

**If classified:**
- Banner lines: Classification level centered in top and bottom margins — *Ch 7 ¶4, Figure 7-5*
- Portion markings: (U), (C), (S), (TS) before each paragraph — *Ch 7 ¶4, Figure 7-5*
- Classification Authority Block (CAB): First page, includes "Derived from:" and "Declassify on:" — *Ch 7 ¶4, Figure 7-5*
- Serial number: Must include classification initial (e.g., Ser N00/S20) — *Ch 7 ¶3c*

**If CUI/FOUO:**
- Mark "FOR OFFICIAL USE ONLY" at bottom of pages containing FOUO — *Ch 7 ¶5a, Figure 7-7*
- Portion markings "(FOUO)" before FOUO text — *Ch 7 ¶5b*
- Alternative: "UNCLASSIFIED//FOR OFFICIAL USE ONLY" or "UNCLASSIFIED//FOUO" — *Ch 7 ¶5a*

**Unclassified letter with classified enclosure:**
Per Ch 7 ¶4, Figure 7-6:
- Statement at bottom: `UNCLASSIFIED when separated from classified enclosures` or `UNCLASSIFIED when Enclosure 2 is removed`

---

## Letterhead Stationery Requirements

Per Appendix C:

| Element | Requirement | Source |
|---------|-------------|--------|
| **Seal** | 1" diameter DoD seal, 0.5" from upper left and top edge | App C ¶1b |
| **First Line** | "DEPARTMENT OF THE NAVY" centered, 5/8" from top, 10-12pt | App C ¶1d(1) |
| **Activity Name** | 6-9pt matching font | App C ¶1d(2) |
| **Address/ZIP** | 6pt capital letters, centered | App C ¶1d(3) |
| **Bottom of Printing** | 1-1/16" from top of trimmed sheet | App C ¶1d(5) |

### Computer Generated Letterhead

| Element | Requirement | Source |
|---------|-------------|--------|
| **Font** | Times New Roman, Century Schoolbook, Courier New, Helvetica, Arial, or Univers *(RECOMMENDED)* | App C ¶2a |
| **"DEPARTMENT OF THE NAVY"** | 10pt bold | App C ¶2a |
| **Address lines** | 8pt | App C ¶2a |
| **First line position** | Centered on 4th line from top | App C ¶2b |

---

## Key "Via" Line Rules

Per Ch 7 ¶8, Ch 2 ¶1:

- "Via" addressee **must always forward with endorsement** — *Ch 2 ¶1a(3)*
- Number "Via" addressees if 2+ listed — *Ch 7 ¶8c*
- May "alter the order of any remaining 'Via' addressees or add others" — *Ch 9 ¶1*
- Rushed routing: Send advance copy to "To" addressee, note "(advance)" — *Ch 2 ¶1a(4)(a)*

---

## Proofreading Checklist

Per Ch 2 ¶19:

**Format checks:**
- [ ] Is letterhead correct/straight?
- [ ] Are the margins 1 inch?
- [ ] Are page numbers centered 1/2 inch from bottom?
- [ ] Is there enough/too much room for the date?
- [ ] Are paragraphs aligned/indented properly?
- [ ] Are paragraphs sequentially numbered/lettered?
- [ ] Are enclosure markings correct?
- [ ] Are more than three lines hyphenated? Are successive lines hyphenated?
- [ ] Is there enough room for the signature line?
- [ ] Is the header margin 1 inch from top?
- [ ] Is the footer margin 1/2 inch from bottom?

**Text requirements:**
- [ ] A signature page must have at least two lines of text preceding the signature — *Ch 7 ¶13*
- [ ] No "pen and ink" changes — correspondence must be error-free before signing — *Ch 2 ¶2*

---

## Response Deadlines

Per Ch 2 ¶7:

| Correspondence Type | Deadline | Source |
|---------------------|----------|--------|
| General correspondence | 10 working days | Ch 2 ¶7a |
| Congressional correspondence | 5 working days | Ch 2 ¶7a(2) |
| HqDON general | 10 working days | Ch 12 ¶4a |
| HqDON Congressional | 5 working days | Ch 12 ¶4b |
| FOIA/Privacy Act requests | 20 working days | Ch 2 ¶8c |

If deadline cannot be met, send **interim response** — *Ch 2 ¶7, Ch 12 ¶6*

---

## Complimentary Close Options

### Standard Naval Letter
Per Ch 7 ¶14a(2):
- **NO complimentary close** — signature only

### Business Letter
Per Ch 11 ¶8:
- **"Sincerely,"** (followed by comma) *(REQUIRED)*

### Executive Correspondence Letters
Per Ch 12 ¶4:

| Addressee | Complimentary Close |
|-----------|--------------------|
| Routine/Congressional | "Sincerely," |
| Flag personal letter | "Sincerely," |
| Flag/General Officers junior in rank | "Respectfully," |
| Flag/General Officers senior in rank | "Very respectfully," |
| Thank you, Birth announcements, Condolences | "Warm regards" |
| High ranking civilians, Senators, Congress, Governors | "Sincerely yours," or "With great respect," |
| All others | "Sincerely," or "All the best," |

### Executive Memorandums
Per Ch 12 ¶2p:
- **NO complimentary close** in memorandums

### E-mail
Per Ch 4 ¶1c:
- "Sincerely yours" or "With great respect" (Civilians)
- "Respectfully" (Junior in rank to signer)
- "Very respectfully" (Senior in rank to signer)
- **Abbreviations allowed in reply:** "V/r," and "R/,"

---

## Hyphenation Rules

Per Ch 2 ¶18:

| Rule | Requirement |
|------|-------------|
| General | Use hyphens sparingly |
| Right margin | Slightly uneven margin preferred over hyphenated words |
| End of page | **NEVER** hyphenate a word at end of page |
| Consecutive lines | Avoid hyphenating successive lines |
| Maximum | No more than 3 hyphenated lines in a row |
| Close associations | Avoid separating: person's name, abbreviated titles, dates |
| Splitting names | If must split, do so after first name (when no initial) or after initial |
| Reference | Use dictionary for dividing words |

---

## Window Envelope Rules

Per Ch 7 ¶18, Ch 2 ¶3c, Figure 7-3:

### When to Use
- Eliminates cost of addressing envelopes
- Reduces errors

### Requirements
- GSA general-purpose window envelope: 9-1/2" × 4-1/8" overall, window 4-3/4" × 1-1/4" in lower left
- Address must have **no more than 5 lines**
- Address must **not extend past middle of page**
- Complete address must appear in window with **at least 1/8" margin** even if letter shifts
- Letter and all enclosures must be **unclassified**
- Letter must have **no "Via" addressees**

### Do NOT Use Window Envelope For
Per Ch 2 ¶3c:
- Classified material
- Material with "Via" addressees
- Addresses longer than 5 lines

### Letter Format Changes (Figure 7-3)
- **Omit "From:" line** — letterhead shows origin
- Address goes where "To:" line normally would
- Every copy to outside addressees **must be on letterhead**

### Folding for Window Envelope
Per Ch 7, Figure 7-3:
1. First, turn up bottom edge so it just covers the subject
2. Second, turn back address portion so upper fold falls along top of subject

---

## Folding Techniques

Per Ch 6, Figure 6-1:

### Standard Letter-Size Envelope (#10)
1. Fold bottom third up
2. Fold top third down, leaving 1/4" at top

### Small Envelope (#6 3/4)
1. Fold bottom half up
2. Fold right third over
3. Fold left third over, leaving 1/4" margin

### General Rules
- Documents with **6 or fewer pages** should be folded and mailed in letter-size envelope
- Use large envelopes for material that cannot be folded (photographs, diplomas, etc.)

---

## Package Assembly Rules

Per Ch 7 ¶18-19, Figure 7-9:

### Tabbing Requirements
- Tab the **signature page** (if not first page)
- Tab **enclosures**
- Tab **background material**
- Label tabs appropriately
- Tabs must be removable without defacing document

### Assembly Order (in folder)
**Left side:**
1. Brief sheet (if required)

**Right side (top to bottom):**
1. Original letter (with enclosures) to be signed
2. Courtesy copy (with enclosures)
3. Via addressee(s) copy(s) (with enclosures)
4. Envelope or mailing label
5. Info addressee(s) copy(s) (with enclosures)
6. Envelope or mailing label
7. Official file copy (with enclosures)

### Executive Correspondence Assembly
Per Ch 12 ¶5, ¶3a(9):
- **Do NOT staple**
- **Do NOT use clam clips**
- Use two-fold or three-fold folder
- Action/info memo on top (right side for two-fold, centered for three-fold)
- Tabs must be typed and displayed consecutively on far right
- Reviewer should be able to see all tabs at once

### Tab Identification (Executive)
| Tab | Contents |
|-----|----------|
| TAB A | Action item (item for signature/approval) |
| TAB A-1, A-2 | Multiple items for signature |
| TAB B | Incoming correspondence |
| TAB C | Background information |
| Last Tab | Coordination page |

---

## Copy To and Blind Copy Rules

Per Ch 7 ¶15, Ch 2 ¶5:

### Copy To Line
- Position: Left margin, 2nd line below signature line
- Use: "addressees outside your activity who need to know a letter's content but do not need to act on it"
- Keep number of activities to minimum
- Use SNDL short title and/or SNDL numbers

### Format Options
**Single column (normal):**
```
Copy to:
CNO (N1, N2, N3/5)
COMNAVPERSCOM (PERS 313C)
```

**Column format (large list):**
```
Copy to:
CNO (N1, N2, N3/5)              USS YORKTOWN (ADMIN)
COMNAVPERSCOM (PERS 313C)       USS MUSTIN
```

**Paragraph format (large list):**
```
Copy to:
CNO (N1, N2, N3/5), COMNAVPERSCOM (PERS 313C), COMCARSTRKGRU ELEVEN,
USS YORKTOWN (ADMIN), USS MUSTIN
```

**Continuation to next page:**
```
Copy to: (see next page)
```
then on next page:
```
Copy to: (Cont'd)
NAS Meridian
USS YORKTOWN
```

### Blind Copy To
Per Ch 7, Figure 7-2:
- "Blind copy to" addressees appear on **internal copies only**
- Do NOT appear on original or external copies
- Also used for: identity of writer and typist

### Congressional Correspondence
Per Ch 2 ¶5b:
- Send **blind copy** of final reply and substantive interim replies to Office of Legislative Affairs (OLA)
