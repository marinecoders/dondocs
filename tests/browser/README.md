# Browser integration tests

## Install coverage and PR scope

The install controls must either invoke an available native prompt or open
usable instructions. Store-level unit tests cannot catch missing click handlers,
dialog focus problems, or incorrect platform instructions.

This suite runs the real production app with its manifest and service worker.
It exercises Help → Support → Install app, command search, the passive install
banner, and the getting-started checklist. The existing upgrade suite remains
independent and still requires two production builds.

| Project | Browser and environment |
| --- | --- |
| `chromium` | Playwright Chromium, desktop |
| `chrome` | Installed Google Chrome channel, desktop |
| `msedge` | Installed Microsoft Edge channel, desktop |
| `firefox` | Playwright Firefox, desktop |
| `webkit` | Playwright WebKit, desktop Safari profile |
| `mobile-chrome` | Chromium, Pixel 7 touch/viewport/UA emulation |
| `mobile-safari` | WebKit, iPhone 13 emulation |
| `ipad-safari` | WebKit, iPad touch/viewport with desktop Mac UA |
| `mobile-chrome-ios` | WebKit, iPhone with a Chrome iOS UA fixture |

Checks cover:

- Browser-specific fallback content, focus inside the install dialog, closing
  with the close control or Escape, and returning focus to the Help action.
- All four install entry points and capability-dependent checklist visibility.
- Chromium prompt acceptance, dismissal, and rejection; each event is invoked
  once during user activation and the next attempt uses instructions. These tests inject a synthetic
  `beforeinstallprompt` event and run only in Chromium-based projects.
- Synthetic `appinstalled`, standalone display-mode, and iOS `navigator.standalone`
  startup signals hiding install controls.
- A captured event never surviving a page reload.
- iOS banner dismissal surviving reload without disabling explicit installation.
- Served manifest fields, real PNG icon responses, and an activated service worker.

## Run locally

```sh
npm ci
npx playwright install chromium firefox webkit
npm run build
npm run test:install -- --project=chromium --project=firefox --project=webkit --project=mobile-chrome --project=mobile-safari --project=ipad-safari --project=mobile-chrome-ios
```

With Google Chrome and Microsoft Edge installed, `npm run test:install` runs all
nine projects. CI installs both branded channels and runs every project, grouped
by engine, on pull requests and pushes to main. No project silently falls back to
another browser. Failures retain HTML reports, screenshots, and Playwright traces.

The suite starts a dedicated Vite production preview on `127.0.0.1:4173`; it
fails if that port is already occupied. Build again after changing application
code. `npm run test:upgrade` continues to run only `upgrade.spec.ts`, with
`UPGRADE_OLD_BUILD` set to the previous production build directory.

## Boundaries and release verification

Browser events and standalone signals are controlled fixtures, not proof that
an OS installed an app. Playwright cannot drive the browser chrome or the iOS
share sheet. WebKit and mobile emulation are not the installed Safari app or
physical devices. The manifest/worker smoke check catches packaging failures;
it does not assert native install eligibility or enterprise policy behavior.

Before releasing installation changes, verify on actual devices:

1. Chrome and Edge desktop: install from the app, dismiss and retry, launch the
   installed window, and confirm install actions disappear.
2. macOS Safari: follow File → Add to Dock and launch from the Dock.
3. iPhone Safari and Chrome: follow Share → Add to Home Screen, launch the icon,
   and confirm the app no longer offers installation. Check iPad desktop mode too.
4. Android Chrome: native prompt and browser-menu fallback, then installed launch.
5. Firefox and policy-restricted browsers: ensure the fallback is actionable and
   the editor remains usable, even when native installation is unavailable.

The iOS Chrome instructions follow [Google's install guidance](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS&hl=en).
See [Playwright's browser coverage](https://playwright.dev/docs/browsers) for
the distinction between branded channels, engine builds, and device emulation.
