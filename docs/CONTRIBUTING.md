# Contributing to DonDocs

DonDocs welcomes contributors from every military branch: active-duty, Guard and Reserve members, veterans, civilian employees and contractors.

Contributors outside the military community are welcome to get involved. Please contact the maintainers to discuss your proposed contribution and receive approval before starting work.

You can help by reviewing formats, testing workflows, writing templates, improving instructions or contributing code. Experience preparing and routing these documents is useful even if you have never submitted a pull request.

## Ways to help

- **Report a problem:** explain what you did, what happened and what you expected. Include the browser, document type and a synthetic example.
- **Review a format:** identify the service and document type, then cite the governing publication, edition and paragraph. Show the expected layout and where the output differs.
- **Improve a template or guide:** use a realistic scenario with fictional names and details. Follow the [template guide](CREATING_TEMPLATES.md) for new starters.
- **Test a change:** check the affected workflow on your device and report the build, browser and result. Screenshots help when they show the specific issue.
- **Contribute code:** keep the change focused and include the checks needed to demonstrate it works.

Discuss new document formats, major workflow changes and dependency additions with maintainers before starting. Small fixes can go straight to a pull request.

## Before posting

This repository is public. Use made-up examples. Keep real document contents, names, personnel identifiers, rosters, credentials, CUI and classified information out of issues, commits, screenshots, PDFs and test fixtures. Check logs and URLs before sharing them.

Report vulnerabilities through [private security reporting](../SECURITY.md), not a public issue or pull request.

Submit only work you have authority to contribute under the project license. Retain third-party notices and identify separately licensed material in your PR. Contributions use GNU AGPL version 3 only (`AGPL-3.0-only`) unless separately identified and agreed otherwise. You retain your copyright; contributing does not assign it or grant separate proprietary licensing rights. See [licensing](LICENSING.md).

## Local setup

Use Git, npm and Node **22.13+ on the Node 22 line**. Other Node lines must satisfy the locked dependencies' engine requirements. CI uses Node 22; the standalone companion bundle has its own runtime requirement.

```sh
git clone https://github.com/marinecoders/dondocs.git
cd dondocs
npm ci
npm run dev
```

The development server runs at `http://localhost:5173`. First setup needs network access for dependencies and vendor assets. Fork the repository if you need your own push remote.

The [architecture guide](ARCHITECTURE.md) maps the source. [Deployment](DEPLOYMENT.md) covers production builds, Docker and offline setup.

## Making a change

Start a focused branch from current main. Use the existing component, store and styling patterns. Keep generated output tied to its captured document revision through asynchronous work and document switches.

For UI changes, check desktop and mobile layouts in Light, Dark and Classic. For document output, review the rendered file as well as the code. Identify the service and governing source when changing a formatting rule. New formats should follow the requirements of their service and document type.

Use the [form-package guide](FORM_TEMPLATES.md) for static forms and the [publication guide](TECHNICAL_PUBLICATIONS.md) for structured publications. A new layout format needs matching validation, controls, renderers, companion support and tests.

### LaTeX spacing standards

The existing correspondence layouts use the same **12 pt gap** between ordinary paragraphs and subparagraphs through `src/services/latex/paragraphLayout.ts`. Numbered continuation lines return to the left margin; business and HQ formats have their own indentation rules.

Preserve deliberate format-specific spacing in tables, acknowledgement blocks and other exceptions. Edit canonical files under `tex/`, then run `node build-templates.mjs` and commit the generated bundle. The native PDF and Word subparagraph-spacing tests check the shared rule.

## Testing

Run the normal checks before submitting code:

```sh
npm test
npm run docs:check
npm run lint
npm run build
```

The build runs the TypeScript solution and Vite, including npm's prebuild/postbuild hooks. Use `npx tsc -b` for typechecking alone.

For documentation-only changes, run `npm run docs:check`. Add checks for the behavior you changed:

| Change | Additional checks |
|---|---|
| UI or editor | Relevant component/browser tests; desktop and mobile inspection. |
| PDF/Word output | Focused `npm run test:integration -- tests/integration/NAME.test.ts`; inspect rendered output. Native tests may need pdfLaTeX, Pandoc and Poppler. |
| TeX templates | `node build-templates.mjs`, commit the bundle and run affected compile tests. |
| pdf.js dependency | `npm run sync:pdf-worker`, commit the worker and check viewer/download behavior. |
| Capabilities or registries | Regenerate `npm run docs:capabilities` and `npm run docs:inventory`, then run `npm run docs:check`. |
| Form model or packages | Regenerate the JSON Schema after model changes; follow the [package and geometry checks](FORM_TEMPLATES.md#verification-commands). |
| Storage or backups | Relevant persistence/restore tests and [upgrade rehearsals](FORM_LIBRARY_ROLLOUT.md). |
| Companion or bundle | Relevant HTTP/MCP tests, `npm run build:companion` and `npm run build:mcpb`. |
| Managed delivery | Follow [UPDATE_DELIVERY.md](UPDATE_DELIVERY.md), including retained history and qualification. |

The [test guide](../tests/README.md) lists separate suites and prerequisites. Python pipeline tests run separately from Vitest. Native device checks remain necessary where required; browser emulation does not replace an installed iPhone test.

Use `make pdf` to build the [checked-in TeX example](../tex/README.md#building-the-checked-in-example). This is separate from rendering the active browser document.

## Submitting a pull request

Use the [PR template](../.github/PULL_REQUEST_TEMPLATE.md). Explain the problem, the resulting behavior and what you checked. Include synthetic screenshots or sample output when they help a reviewer assess the change. State any checks you could not run.

Keep commits focused and address feedback on the same branch. Review the diff for unrelated files, generated artifacts and sensitive data before pushing. Be respectful and keep discussion about the work.

Documentation-only changes can leave the package version unchanged. Add an Unreleased changelog entry when useful to users or contributors. Versioned releases update the package/lockfile together and add the matching changelog section; the [release workflow](../.github/workflows/release.yml) handles the tag and bundle. Managed site publishing has separate gates. Coordinate release changes with maintainers to avoid duplicate tags or releases.
