# Browser tests

Playwright checks production builds through three separate runners:

| Command | Test files | Build inputs |
|---|---|---|
| `npm run test:browser` | Install, downloads, settings navigation, preview zoom, document lifecycle and Excel rosters | Current normal build in `dist/`. |
| `npm run test:upgrade` | `upgrade.spec.ts` | Previous normal build through `UPGRADE_OLD_BUILD`, plus current `dist/`. |
| `npm run test:releases` | `releases.spec.ts` | Managed A/B/C/broken artifacts and the pinned legacy build; see [update delivery](../../docs/UPDATE_DELIVERY.md#qualify-and-enable-publishing). |

The configs are [playwright.browser.config.ts](../../playwright.browser.config.ts), [playwright.config.ts](../../playwright.config.ts) and [playwright.releases.config.ts](../../playwright.releases.config.ts), respectively. These suites run separately from Vitest.

## Normal browser checks

| Suite | Checks |
|---|---|
| `install.spec.ts` | Install actions, fallback instructions, focus, dismissal, synthetic install events, installed-state visibility, manifest/icons and service-worker activation. |
| `downloads.spec.ts` | PDF text and filenames, DOCX ZIP integrity and document XML, both TeX formats, draft JSON, PDF startup recovery, Word resource retries, endorsement/page-number output and the iOS Chrome PDF-tab save link. |
| `settings-navigation.spec.ts` | Backup controls and focus in Settings at desktop, narrow and landscape sizes; Help, search and tour entry points. |
| `preview-zoom.spec.ts` | Manual zoom, Fit page and Fit width through document/form switches, preview reopening and reload. |
| `document-lifecycle.spec.ts` | Reload detection, pasted-letter review/correction in all themes, import-feedback layout, import/Undo/Redo persistence and built-in-form signature defaults. |
| `excel-roster.spec.ts` | Real Excel upload, first-worksheet preview, header selection, automatic mapping, date/identifier/missing-value warnings, row corrections and modal overflow. |

Install tests allow service workers. The other suites block them so cached responses do not hide routed network fixtures. Upgrade and managed-release tests exercise real service-worker transitions separately. Some cases are platform-specific and skip on other projects; inspect the executed and skipped results.

## Browser projects

The normal browser runner defines nine projects:

| Project | Runtime/profile |
|---|---|
| `chromium` | Playwright Chromium |
| `chrome` | Installed Google Chrome channel |
| `msedge` | Installed Microsoft Edge channel |
| `firefox` | Playwright Firefox |
| `webkit` | Playwright WebKit with a desktop Safari profile |
| `mobile-chrome` | Chromium with Pixel 7 emulation |
| `mobile-safari` | WebKit with iPhone 13 emulation |
| `ipad-safari` | WebKit with iPad touch/viewport settings and a desktop Mac user agent |
| `mobile-chrome-ios` | WebKit with an iPhone profile and a Chrome iOS user agent |

The upgrade and managed-release runners each use three projects: `chromium`, `firefox` and `webkit`.

## Run locally

From the repository root, follow the [source prerequisites](../../docs/CONTRIBUTING.md#local-setup), then run:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run build
npm run test:browser -- --project=chromium --project=firefox --project=webkit
```

The normal runner starts a dedicated preview at `http://127.0.0.1:4173` and fails if the port is occupied. It uses the existing `dist/`; rebuild after application changes. Chrome and Edge projects require those browser channels to be installed. `npm run test:browser` selects all nine projects.

Select a suite or project as needed:

```sh
npm run test:install -- --project=chromium
npm run test:downloads -- --project=mobile-chrome-ios
npm run test:browser -- settings-navigation.spec.ts --project=webkit
npm run test:browser -- --list
```

For a normal-build upgrade rehearsal, build the previous revision in a separate checkout and the candidate in the current checkout:

```sh
UPGRADE_OLD_BUILD=/absolute/path/to/previous/dist npm run test:upgrade -- --project=chromium
```

This runner starts its own server and retains the previous assets under the same test origin. It checks saved edits, attachments, multiple tabs, backup/restore, storage initialization, template-cache transitions and runtime deployment-policy loading. It does not use the preview on port 4173. Managed-release prerequisites and commands are in the [update-delivery runbook](../../docs/UPDATE_DELIVERY.md).

## CI and device checks

The [test workflow](../../.github/workflows/test.yml) builds the current app and runs all nine normal projects in four groups. These runs allow one retry but fail on flaky results. The separate upgrade job runs on pull requests and builds the PR base as the previous version. [Managed-release qualification](../../.github/workflows/qualify-release.yml) has its own fixtures and hosting checks. Failure jobs retain reports, screenshots and traces under the configured artifact retention periods.

Install events and standalone signals are simulated where needed. Device profiles emulate browser parameters; they do not run actual iOS Chrome, Safari installation dialogs or OS save/share flows. Verify affected native install, installed launch, offline reopening and PDF save/share behavior on real target devices. Managed rollout also requires the real-iPhone and production-host checks in the runbook.

References: [Playwright browsers](https://playwright.dev/docs/browsers) and [device emulation](https://playwright.dev/docs/emulation).
