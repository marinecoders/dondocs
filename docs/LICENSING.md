# DonDocs licensing and source distribution

## Project license

DonDocs is distributed under the GNU Affero General Public License, version 3
only (`AGPL-3.0-only`), in the root `LICENSE` file.
Copyright (c) 2026 Roberto Chiofalo.
DonDocs is provided without warranty, as stated in the license.

Third-party components and public-domain materials retain their existing legal
status; see [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).

## Generated documents

Using DonDocs does not, by itself, apply AGPL to the user's input or generated
letters, PDFs, or DOCX files. AGPL section 2 governs output that itself contains
covered material. Exported LaTeX and other output may include templates, macros,
fonts, or other separately licensed material; their applicable terms still apply.
This notice does not grant a new output exception or override third-party rights.

## Distributing or hosting a build

Preserve the license and copyright notices. When conveying compiled software,
provide Corresponding Source using an applicable method under AGPL section 6.
For modified versions supporting remote network interaction, prominently offer
that version's Corresponding Source to interacting users under section 13.
The license text controls the complete requirements.

Web and companion builds include `LICENSE.txt`, `THIRD_PARTY_LICENSES.txt`,
`LICENSING.txt`, and `SOURCE.txt`. The web About dialog
links to the license and source reference. The MCP bundle carries the same files.
The standalone companion card includes the notices and a source link in its
License and source section. The web app caches the notices for offline access.

`SOURCE.txt` points to the build's Git revision in the official repository, or
its version tag when Git metadata is unavailable. Build official releases from
clean, published commits and ensure the referenced revision/tag is available.
Forks and private deployments must replace the source locations in
`scripts/license-notices.ts` and `src/components/modals/AboutModal.tsx` with an
accessible location for their actual build.
Do not point users to upstream source if it omits your modifications.

Corresponding Source includes the required source, patches, and build/install
scripts for the shipped code and covered dependencies.
For offline deployments, supply source and notices through a method that meets
the applicable license requirements and is available to the relevant recipients.

Build instructions are in `README.md` and `docs/COMPANION.md`. User documents,
signatures, credentials, and operational data are not build-source materials and
must not be included in a source release.
