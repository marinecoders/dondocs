# Browser tests

The install and download suites run production builds. The upgrade suite keeps
its separate two-build harness.

| Project | Browser |
| --- | --- |
| `chromium` | Playwright Chromium |
| `chrome` | Installed Google Chrome |
| `msedge` | Installed Microsoft Edge |
| `firefox` | Playwright Firefox |
| `webkit` | WebKit with a desktop Safari profile |
| `mobile-chrome` | Chromium with Pixel 7 emulation |
| `mobile-safari` | WebKit with iPhone 13 emulation |
| `ipad-safari` | WebKit with iPad touch/viewport and a desktop Mac user agent |
| `mobile-chrome-ios` | WebKit with an iPhone profile and Chrome iOS user agent |

## Coverage

- Install controls in Help, search, the banner, and Getting started; fallback
  instructions, focus, snoozing, prompt outcomes, and installed-state visibility.
- Production manifest, PNG icons, and service-worker activation.
- Correspondence and NAVMC 10274 PDF downloads, PDF text, and filenames.
- Word downloads through Pandoc WASM, DOCX checksums, and document XML content.
- Both LaTeX formats and draft JSON, including current subject/body and filenames.
- PDF startup recovery and Word retries after template or engine download failure.
- The iOS Chrome PDF tab and its save link.

Download tests block service workers so network-failure fixtures reach the app.
Install tests leave them enabled. PDF delivery unit tests cover bytes, filenames,
URL cleanup, FileReader errors, and blocked or unavailable popup tabs. Existing
upgrade tests cover backup/restore with attachment bytes; the compile matrix
covers document formats and layouts.

## Run

```sh
npm ci
npx playwright install chromium firefox webkit
npm run build
npm run test:browser -- --project=chromium --project=firefox --project=webkit
```

With Chrome and Edge installed, `npm run test:browser` runs all nine projects.
Use `test:install` or `test:downloads` to select one suite. Device profiles can be
selected with `--project=mobile-chrome`, `--project=mobile-safari`,
`--project=ipad-safari`, or `--project=mobile-chrome-ios`.

The runner starts a dedicated preview on `127.0.0.1:4173` and fails if that port
is occupied. Rebuild after application changes. CI runs all projects, fails on
flaky retries, and retains failure reports, screenshots, and traces.

`npm run test:upgrade` requires `UPGRADE_OLD_BUILD` pointing to the previous
production build. It runs only `upgrade.spec.ts`.

## Device checks

Native installation events and standalone signals are simulated. WebKit and
device emulation do not test actual Safari, OS installation, or system dialogs.
Before releasing changes, check native install, installed launch, and offline
reopen on desktop Chrome/Edge, macOS Safari, iPhone/iPad, and Android Chrome.
Check the PDF save/share flow and blocked popups on real mobile devices.

References: [Playwright browsers](https://playwright.dev/docs/browsers) and
[Chrome iOS installation](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS&hl=en).
