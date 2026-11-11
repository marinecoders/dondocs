# Security policy

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/marinecoders/dondocs/security/advisories/new) to contact the maintainers. Use the private advisory for evidence, questions and follow-up.

Include:

- The affected release or commit, browser or companion version, and deployment type.
- Steps to reproduce the issue using synthetic data. Include a small proof of concept when possible.
- What happened and the access or information an attacker could gain.
- Any workaround you have tested.

Keep exploit details out of public issues, pull requests and discussions. Do not submit credentials, private keys, personal information, CUI, classified information or real document contents. Use synthetic examples.

Test only systems and data you own or have permission to assess. Do not access other people's documents, disrupt public deployments or run destructive tests.

## Response and disclosure

We aim to acknowledge reports within seven calendar days. If you have not received a reply, follow up in the same private report.

Maintainers will investigate, assess impact and share the next step in the private advisory. Fix timing depends on severity and the work required. We may ask you to verify a proposed fix.

For confirmed vulnerabilities, we will coordinate disclosure with the reporter. Advisories will identify affected versions, fixes and required user action. We will ask before naming a reporter. Please coordinate publication of exploit details so users have time to update.

## Supported versions and scope

Security fixes target the latest released version. Include older-version findings when the issue also affects current code. Browser users must accept an available update to receive client-side fixes; self-hosted operators and companion users must update their own installations.

Report issues affecting the web app, companion, distributed bundles or project-operated deployment, including:

- Code execution through imported, shared or rendered content.
- Share-link encryption, unexpected disclosure or unintended transmission of document contents.
- Companion request validation, output-path confinement or unintended file access.
- Unsafe links in generated files, export-review bypasses or exploitable dependencies in shipped code.

Include the attack path for dependency findings. Report deployment-specific problems to the operator as well; report underlying DonDocs defects here.

## Document handling

Editing and browser exports run locally; editor contents are not automatically uploaded. Assets load from the deployment. Endpoint checks and external links contact their selected destinations. The companion is a separate local service.

The public site uses Cloudflare Web Analytics at the CDN edge. Unmodified self-hosted builds do not include that script. See [Cloudflare's data collection documentation](https://developers.cloudflare.com/speed/observatory/rum-beacon/) for its scope.

Share snapshots are password-encrypted, with no server-side revocation or password recovery. Draft files and backups are unencrypted JSON, can include referenced assets, and bypass the rendered-output text review. See the [user guide](docs/USER_GUIDE.md) and [backup rules](docs/STORAGE.md#backups).

The pre-export text review checks supported text in PDF, Word, TeX, share and batch operations. It does not inspect attached PDF or image contents, and a user can acknowledge a warning and continue. Page 11's dedicated EDIPI field intentionally accepts a valid 10-digit value; free-text IDs are still checked. This review assists the user and is not a data-loss-prevention control.

DonDocs is community software, not an official USMC, DON or DoD system. It has no Authority to Operate for classified processing. Classification selectors and printed markings do not enforce access controls or authorize a deployment to process sensitive information. Follow your organization's handling and records requirements.

## Security checks

CI runs dependency audits, security lint rules and SBOM generation. GitHub runs CodeQL separately. Builds check for known public asset-CDN references. Deployment operators remain responsible for their own security assessment.
