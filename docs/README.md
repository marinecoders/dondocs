# DonDocs documentation

Start with the [application README](../README.md) and [output capabilities](CAPABILITIES.md). These guides describe shipped behavior; they do not certify a document for signature or a deployment for classified use.

## Using DonDocs

- [User guide](USER_GUIDE.md): drafts, profiles, sharing, imports, history, Trash, recovery and batches.
- [Technical publications](TECHNICAL_PUBLICATIONS.md): I-Type, SL-3, SL-4 and TM/IETM front matter.
- [Output capabilities](CAPABILITIES.md) and [known limits](OUTPUT_LIMITS.md).
- [Local companion and MCP](COMPANION.md); [bundle installation](../companion/mcpb/README.md).
- [Security and privacy](../SECURITY.md), [classification configuration](CLASSIFICATION_CONFIG.md) and [storage/backup rules](STORAGE.md).

## Contributing and operating

- [Contributing](CONTRIBUTING.md), [architecture](ARCHITECTURE.md) and [generated project inventory](PROJECT_INVENTORY.md).
- [Content templates](CREATING_TEMPLATES.md), [form packages](FORM_TEMPLATES.md), [form model](FORM_MODEL_ANALYSIS.md) and [JSON Schema](form-definition.schema.json).
- [Test suites](../tests/README.md), [native TeX example](../tex/README.md#building-the-checked-in-example) and [correspondence formatting](CORRESPONDENCE_FORMATTING.md).
- [Deployment](DEPLOYMENT.md), [managed update delivery](UPDATE_DELIVERY.md) and [form rollout/recovery](FORM_LIBRARY_ROLLOUT.md).
- [Licensing/distribution](LICENSING.md) and [third-party notices](../THIRD_PARTY_LICENSES.md).

## Reference sources

- [Reference inventory](REFERENCES.md): editions, checksums, authority links and unresolved status checks for the manuals, orders and standards in [references/](references/).
- [Form authoring](FORM_TEMPLATES.md) and [rollout](FORM_LIBRARY_ROLLOUT.md) cover publication checks and upgrade procedures.
- `xfa-manual-queue.tsv` is an acquisition/refusal queue for sources requiring manual handling. Its rows are not published/supported form packages; source review and qualification remain required.
- [Changelog](../CHANGELOG.md) records release history rather than the current feature contract.

Run `npm run docs:check` before submitting documentation changes. Generate registry/test totals with `npm run docs:inventory`; keep capability and form-schema outputs in sync with their source models.
