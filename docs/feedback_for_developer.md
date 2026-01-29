# Developer Feedback: Template Structure and Doctrine Alignment

## Overview
To build this application properly, we need to restructure the template library. The current "one size fits all" approach for `naval_letter` does not accurately reflect USMC administrative doctrine.

Templates must be separated into three distinct "buckets":

1.  **Proper Naval Letters**: Documents that strictly follow **SECNAV M-5216.5**.
2.  **Prescribed Forms**: Official government forms (NAVMC, etc.) where data is mapped onto specific layouts.
3.  **Memoranda**: Internal documents (MFRs) with structured formats but less formality than naval letters.

---

## ✉️ Bucket 1: Proper Naval Letters
These documents use the standard header, "From/To/Via" blocks, and formal paragraph numbering.

| ID | Name | Policy/Governing Manual | Use Case |
| :--- | :--- | :--- | :--- |
| `pft-waiver` | PFT/CFT Waiver Request | MCO 6100.13A | Formal request for medical exemption. |
| `humanitarian-transfer` | Hardship Transfer Request | MCO 1300.8 | Formal request with supporting evidence. |
| `appointment-XXXX` | Appointment Letters | SECNAV M-5216.5 | Orders for collateral duties (Safety, IO, etc.). |
| `report-findings` | Report of Findings | JAGMAN (MCO 5800.16) | Cover letter for command investigations. |
| `award-loa` | Letter of Appreciation | SECNAV M-1650.1 | Formal recognition letter (not a medal). |
| `command-interest` | Letter of Continuity | MCO 1610.7B | To document performance or command priorities. |
| `request-board` | Letter to President of the Board | MCO 1610.7B | To communicate with a selection/promotion board. |

---

## 📄 Bucket 2: Prescribed Forms (Not Naval Letters)
These are **not** letters. They are official forms. The app should collect user data and populate the PDF version of these specific form numbers.

| ID | What it Actually Is | Form Number | System of Record |
| :--- | :--- | :--- | :--- |
| `request-mast` | **Request Mast Form** | **NAVMC 11296** | Command Records |
| `leave-request` | **MOL/NSIPS Module** | N/A | MOL / NSIPS |
| `special-liberty` | **Admin Action Form** | **NAVMC 10274** | Unit Records |
| `page11-request` | **Administrative Remarks** | **NAVMC 118(11)** | OMPF (Official Record) |
| `6105-entry` | **Counseling Entry** | **NAVMC 118(11)** | OMPF (Adverse) |
| `award-nam` | **Personal Award Recommendation** | **NAVMC 11533** | iAPS |
| `meritorious-promo` | **Admin Action Form** | **NAVMC 10274** | Board Package |
| `orders-modification` | **Admin Action Form** | **NAVMC 10274** | IPAC |
| `training-request` | **Admin Action Form** | **NAVMC 10274** | S-3 / G-3 |
| `gtcc-request` | **Travel Card Application** | **GTCC Form** | Citibank / APC |
| `notarized-statement` | **Statement of Witness** | **NAVMC 11869** | Legal / JAGMAN |

---

## 📝 Bucket 3: Memoranda (MFRs)
Internal documents that do not require full naval letterhead but still have a structured format.

*   `counseling-pos/neg` (Internal Record)
*   `legal-hold` (Preservation of Evidence)
*   `mfr-meeting` (Notes for File)
