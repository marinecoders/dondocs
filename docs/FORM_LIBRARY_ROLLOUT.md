# Form library rollout and recovery

## Before deployment

Run unit tests, integration tests, Python script tests, lint, typecheck, and the production build. The browser upgrade job builds the PR's base commit and proposed commit separately, serves both at one origin, and uses real Chromium, Firefox, and WebKit storage and service workers. It checks two tabs, saved attachment bytes, offline reopening, immediate reload in the new build, failed-write recovery, three-tab conflict recovery, and restoring an older backup after another tab saves newer work.

Local reproduction:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run build
UPGRADE_OLD_BUILD=/absolute/path/to/previous/dist npm run test:upgrade
```

The previous build must be a production build, not a development server. Test data is synthetic. Failure screenshots and traces are CI artifacts; do not run the suite against a user's browser profile.

## First upgrade from the old release

Ask users to save, wait for completion, and download a full backup before updating. Refresh their other DonDocs tabs before editing generic forms. Browser storage belongs to the origin: deployment must retain the same scheme, hostname, and port.

The old release can lose an edit when reloaded before its asynchronous database write commits. This was reproduced in the automated upgrade rehearsal. The new write journal and update barrier protect the new release; they cannot change JavaScript already running in an old tab. The old-to-new test therefore verifies committed edits. Separate tests verify pending-edit and failed-write recovery in the new release.

## After deployment

Check that saved letters, built-in form buffers, attachments, and pinned generic form definitions reopen. Failed saves must remain visibly unsaved. Conflicts should offer **Save → Open recovered copies**; they must not replace another tab's saved document. Keep the original backup until the user has checked restored documents and attachment files. A partial restore lists failures and can be retried.

No new official generic form should be published solely because automated placement checks pass. Source suitability and a human review of the mapping remain required. The current official pilot refusals remain unresolved.

## Rollback

Keep immutable form revision directories available. Retiring a catalog entry must not remove files referenced by saved documents.

Prefer a forward fix or a rollback build that retains the new saved-session reader and recovery journal support. An old application build does not understand generic form instances and may drop their fields if it rewrites them. Before a full application rollback, export affected data and prevent editing generic forms with the old build. Do not clear site storage, delete databases, or lower their schema version as a rollback step.

## Rendering qualification and measurements

Publication compares the reviewed base revision with the catalog revision while holding the catalog lock. A stale candidate must be prepared and reviewed again. Publishing the identical revision again remains safe.

Placement checks render distinct text samples, each choice, false booleans, and cleared answers. They subtract the blank template's text before checking added text within placement bounds. Signature placement is reported separately and still requires human review. These checks do not establish that a source form is legally current or that its business meaning is correct.

Run `npx vite-node --config vitest.config.ts scripts/benchmark-form-render.mts` for a repeatable synthetic PDF rendering measurement. On the local Node 26 run, five warm samples had median times of 15.6 ms for 50 placements / 1 page, 42.7 ms for 250 / 5 pages, and 90.8 ms for 1,000 / 20 pages. These measure validation and PDF generation with an in-memory blank template, excluding downloads and UI work. They are a baseline, not a browser latency guarantee. Placement key allocation now uses a counter instead of repeatedly enumerating the growing field map.

## Storage failure checks

Pending writes are retained when a 15-second wait expires. A timeout pauses updates and marks the document unsaved; it does not start a second transaction or discard the first one. A late commit can still complete the save. If reload recovery storage is unavailable, the editor asks the user to keep the tab open until the database confirms the save.

Backup imports validate present sections before applying any changes. Older backups may omit sections introduced later. Imports are limited to 100 MB, 100,000 JSON values and 50 levels of nesting to bound parsing and decoding work. Restore reports persistence failures separately for documents, profiles, snippets, templates, routing, forms, attachments and history. A partial restore keeps successfully restored data; retain the file and retry after storage is available.

Playwright WebKit is not an installed Safari/iPhone test. Before release, perform this manual check on a supported iPhone: save a letter with an attachment, export a backup, background and reopen the installed app, accept an update, then reopen offline and compare the letter and attachment. Repeat after restoring the backup. Record device, OS/browser version, build SHA and result. This device check remains a release requirement until completed on hardware.
