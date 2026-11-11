# Project inventory

Generated with `npm run docs:inventory` from registries, bundled datasets and fixture builders. CI checks for drift. Counts describe this checkout, not regulatory qualification or executed test results.

| Registry | Entries |
|---|---:|
| Configured formats (including aliases exposed by the app) | 24 |
| Built-in forms | 2 |
| Content templates | 19 |
| References | 135 |
| Units | 3,140 |
| Office codes | 74 |
| SSIC codes | 2,240 |

## Content templates

| ID | Name | Format |
|---|---|---|
| `tm-ietm-cover-signature` | TM/IETM Cover and Signature Pages | `tm_ietm_front_matter` |
| `pft-waiver` | PFT/CFT Waiver Request | `naval_letter` |
| `humanitarian-transfer` | Humanitarian/Hardship Transfer Request | `naval_letter` |
| `award-nam` | Award Recommendation (NAM) | `naval_letter` |
| `award-loa` | Letter of Appreciation | `naval_letter` |
| `command-interest` | Command Interest Letter | `naval_letter` |
| `appointment-collateral-duty` | Appointment to Collateral Duty | `naval_letter` |
| `appointment-acknowledgement` | Appointment Acknowledgement (Endorsement) | `same_page_endorsement` |
| `appointment-board-member` | Appointment to Board/Committee | `naval_letter` |
| `appointment-safety-officer` | Appointment as Safety Officer | `naval_letter` |
| `report-findings` | Report of Findings | `naval_letter` |
| `appointment-investigating-officer` | Appointment as Investigating Officer | `naval_letter` |
| `letter-of-instruction-ops` | Letter of Instruction (Operations) | `naval_letter` |
| `modification-instruction` | Modification Instruction (MI) | `i_type` |
| `supply-instruction` | Supply Instruction (SI) | `i_type` |
| `technical-instruction` | Technical Instruction (TI) | `i_type` |
| `lubrication-instruction` | Lubrication Instruction (LI) | `i_type` |
| `sl3-components-list` | SL-3 Components List | `sl3` |
| `sl4-repair-parts-list` | SL-4 Repair Parts List | `sl4` |

## Compile fixture builders

| Quantity | Count |
|---|---:|
| Matrix format entries | 22 |
| Pairwise fixtures per output path | 440 |
| Smoke fixtures | 286 |
| Cartesian fixtures per matrix format | 1,769,472 |
| Full Cartesian fixtures per output path | 38,928,384 |

Matrix-excluded configured formats: `sl4`, `tm_ietm_front_matter`. These have dedicated tests; exclusion is not a claim that they are unsupported. Built-in/configured forms also have separate tests. The generic matrix is not the entire integration suite.

See [integration tests](../tests/integration/README.md), [Cartesian harness](../tests/cartesian/README.md) and [output capabilities](CAPABILITIES.md).
