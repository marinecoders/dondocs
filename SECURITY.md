# Security Policy

## Reporting a vulnerability

Report privately through GitHub's **[Private Vulnerability Reporting](https://github.com/marinecoders/dondocs/security/advisories/new)** — not a public issue, and not a pull request.

Include what you found, how to reproduce it, and what an attacker gets out of it. A proof of concept helps.

**Do not include CUI, PII, or real document content in a report.** A redacted reproduction is always enough.

Expect an acknowledgement within a week. This is maintained on personal time, so fixes ship when they ship — but you'll be told where things stand rather than left guessing.

## Supported versions

The latest release only. DonDocs auto-updates in the browser and there are no long-lived branches, so fixes land on `main` and ship as the next version.

## Scope

**In scope**

- Cross-site scripting, or any path from imported/shared content to code execution
- Flaws in the share-link encryption (`src/lib/shareCrypto.ts`)
- Bypasses of the URL allowlist (`src/lib/url-safety.ts`) that make an unsafe scheme clickable in an export
- Ways a document's content leaks off the machine — the app makes no network calls at runtime, so any is a bug
- Failures in the PII/PHI pre-export scan that let a flagged value through silently
- Dependency vulnerabilities that are actually reachable from shipped code

**Out of scope**

- The classification domain gate (`src/lib/domainClassification.ts`). It reads the hostname to narrow the level list — it is client-side, trivially bypassable, and documented as guidance rather than enforcement. It is not a security control.
- Anything requiring an already-compromised browser, malicious extension, or physical access to an unlocked machine.
- Findings against a fork or a modified build.
- Missing hardening headers on a deployment you control.

## What this project does not promise

- **It is not accredited for classified processing.** It has no Authority to Operate and is not under the Risk Management Framework. The classification and CUI markings it prints are formatting, not a security control. You own how the resulting document is handled.
- **It is not official.** Not USMC, DON, or DoD software. Verify every document against the governing instruction before you sign it.
- **Documents you create are records** under 44 U.S.C. § 3301 when used for official business. Routing them per your command's records policy is yours, not the app's.

## How the code is checked

- CodeQL static analysis on every push and pull request
- `npm audit --audit-level=high` in CI, with no exceptions carried
- `eslint-plugin-security` in the lint pass
- A postbuild guard (`scripts/check-no-cdn.mjs`) that fails the build if any CDN reference reaches `dist/` — the app must load nothing from a third party at runtime
- A CycloneDX SBOM of production dependencies generated on every CI run (`npm run sbom`), retained as a build artifact
