# Classification marking configuration

These settings control which marking options the browser offers and validates for exports. They are public client-side configuration. A hostname, selector or printed banner does not authorize a system to process classified information or CUI. See [SECURITY.md](../SECURITY.md) for the project's security scope.

The configuration does not determine the classification of entered text or attachments, control who can access the application, or prevent someone from entering information above the configured marking options. Selecting UNCLASSIFIED does not declassify information.

Deployment owners must obtain the required system authorization and configure their deployments for the approved use. Authorized authors must apply the governing classification or CUI guidance and review the finished document's markings before distribution. Do not enter CUI or classified information into a deployment without your organization's approval for that use.

## Marking terminology

The three U.S. national security classification levels are **CONFIDENTIAL, SECRET and TOP SECRET**. UNCLASSIFIED is a status; CUI identifies unclassified information requiring safeguarding or dissemination controls. Neither is an additional classification level. See [Executive Order 13526, section 1.2](https://www.archives.gov/isoo/policy-documents/cnsi-eo.html) and the [NARA CUI program](https://www.archives.gov/cui).

Basic markings, before any applicable additional controls, are:

| Information | Banner text | Portion mark |
|---|---|---|
| Unclassified, without CUI | `UNCLASSIFIED`, when required by the document's marking rules | `(U)` |
| Controlled unclassified information, under DoD rules | `CUI` | `(CUI)` |
| Confidential | `CONFIDENTIAL` | `(C)` |
| Secret | `SECRET` | `(S)` |
| Top Secret | `TOP SECRET` | `(TS)` |

The classified portion abbreviations come from [32 CFR 2001.21](https://www.archives.gov/isoo/policy-documents/isoo-implementing-directive.html). A complete classified document also needs the applicable classification authority and declassification information. Derivatively classified documents identify their source guidance in a `Derived From` entry. See [NARA's classification authority block guidance](https://www.archives.gov/files/isoo/training/classification-authority-block.pdf). A banner alone is insufficient.

For unclassified DoD CUI documents, use `CUI` in the header and footer, plus a designation indicator block. Do not substitute `U//CUI`, `CONTROLLED`, or a category such as `CUI//OPSEC`. DoD places categories and applicable dissemination controls in the designation block. Portion markings are optional on unclassified CUI documents; if used, apply them throughout, including subjects, titles and graphics, except the designation block. See the [DCSA DoD CUI Marking Guide](https://www.dcsa.mil/Portals/128/Documents/CTP/CUI/DoD%20CUI%20Marking%20Guide%20DEC%202024.pdf). These are DoD rules; other agencies may implement the government-wide CUI program differently.

Mark the first page or cover `CUI` at the top and bottom. Interior pages without CUI may be marked `UNCLASSIFIED`; retaining `CUI` throughout is also permitted. See the [DoD banner-line guidance](https://www.dodcui.mil/Training/Banner-Line/).

For a classified document containing CUI portions, retain the highest classification in the overall banner; do not add `CUI` to that banner. Apply the CUI portion marks and other required indicators separately. See [DoDI 5200.48, paragraph 3.4.c](https://www.dodcui.mil/Portals/109/Documents/Policy%20Docs/DoDI%205200.48%20CUI.pdf).

SCI adds access controls to classified information; it is not a level above TOP SECRET. The banner must identify the applicable SCI control systems and any required compartments or dissemination controls. A generic `SCI` suffix does not identify those controls. See [CDSE marking syntax](https://www.cdse.edu/Portals/124/Documents/jobaids/information/MarkingSyntax.pdf) and the [IC marking examples](https://www.cdse.edu/Portals/124/Documents/jobaids/information/IC-Markings-System-Register.pdf). Use the governing classification guidance to determine the markings; do not infer them from a hostname or invent default compartments.

FOUO is a legacy marking, not a classification level or an automatic CUI designation. Do not use it as a default for new documents. Assess the information against current CUI requirements when reusing it. See [DCSA CUI training](https://www.dcsa.mil/Portals/128/Documents/CTP/CUI/DCSA%20CUI%20Training%20Template%20Version%203.pdf).

## Cloud impact levels and processing authorization

In the DoD cloud framework, **Impact Level 6 (IL6) accommodates classified information up to and including SECRET**. CONFIDENTIAL and SECRET fall within that range; TOP SECRET does not. IL6 describes cloud security requirements. The document's classification marking remains `CONFIDENTIAL` or `SECRET`. See [DISA's DISN Connection Process Guide](https://dl.dod.cyber.mil/wp-content/uploads/connect/pdf/unclass-DISN_CPG.pdf).

An IL6 cloud offering does not by itself authorize every application, endpoint or user to process classified information. The deployed system and its use must have the appropriate authorization. DonDocs configuration controls marking options; it does not issue or verify that authorization.

## Default marking options

Without a matching override, the browser application uses the current hostname. This table describes the existing fallback behavior:

| Hostname | Available application options |
|---|---|
| `smil.mil`, `smil`, and their subdomains | UNCLASSIFIED, CUI, CONFIDENTIAL, SECRET |
| `ic.gov` and its subdomains | All six application options, including the existing `top_secret_sci` option |
| Other hosts ending in `.mil` or `.gov` | UNCLASSIFIED, CUI, CONFIDENTIAL |
| Other hosts, including localhost | UNCLASSIFIED |

A `.mil`, `.gov`, `smil.mil` or `ic.gov` hostname does not establish the system's authorization to process classified information. In particular, **CONFIDENTIAL is classified**, even though the current fallback offers it on ordinary `.mil` and `.gov` hosts.

Configure each deployment explicitly for its authorized use rather than relying on hostname defaults. For a public, unclassified-only deployment, set `maxLevel` to `unclassified` and `allowedLevels` to `["unclassified"]`. Add CUI or classified marking options only where the deployed system is authorized to process the corresponding information. The application currently retains the hostname fallbacks shown above when no matching override is configured.

The configuration identifiers, in application order, are `unclassified`, `cui`, `confidential`, `secret`, `top_secret` and `top_secret_sci`. The `level` field names and ordering are part of the application's data model, not six official classification levels or a determination of what a network may handle.

The existing `top_secret_sci` option displays and exports `TOP SECRET//SCI`. It does not collect or validate the specific SCI controls described above. Configuration selects available options; it does not establish that an export has every required marking.

This deployment policy applies to browser exports. The separately run [companion](COMPANION.md) does not load the site's runtime policy file.

## Runtime configuration

Place an override in `public/classification.config.json` before building, or update `/classification.config.json` on the deployed site. This example offers CUI markings for a deployment authorized to process CUI:

```json
{
  "maxLevel": "cui",
  "allowedLevels": ["unclassified", "cui"],
  "overrideDomain": "docs.example.test",
  "includeSubdomains": false,
  "overrideMessage": "This deployment offers UNCLASSIFIED and CUI marking options."
}
```

Replace `docs.example.test` with the deployment's hostname. Omit `overrideDomain` to apply the configuration on every host serving that file.

| Field | Rule |
|---|---|
| `maxLevel` | Required. One of the six application identifiers. |
| `allowedLevels` | Required, nonempty list. Include `unclassified` and `maxLevel`; every entry must be at or below the maximum in application order. Intermediate options may be omitted. |
| `overrideDomain` | Optional hostname. Exact matching by default. Do not supply a URL, port, path or wildcard. |
| `includeSubdomains` | Optional boolean, default `false`. Setting it to `true` requires `overrideDomain`. |
| `overrideMessage` | Optional text shown to the user. Describe the available markings without implying processing authorization. |

Hostnames are normalized for case and a trailing dot. With `includeSubdomains: true`, `docs.example.test` matches that host and its subdomains, but not `otherdocs.example.test`.

The normal build stages a `null` config when none is present. A `null` response or HTTP 404 selects hostname defaults. Invalid JSON or field values produce a policy error. A request that cannot load from the network or an offline fallback also produces an error.

## Build-time configuration

Set the variables before `npm run build`:

```sh
export VITE_CLASSIFICATION_MAX_LEVEL=cui
export VITE_CLASSIFICATION_ALLOWED_LEVELS=unclassified,cui
export VITE_CLASSIFICATION_OVERRIDE_MESSAGE="This deployment offers UNCLASSIFIED and CUI marking options."
npm run build
```

Optional scope variables are `VITE_CLASSIFICATION_OVERRIDE_DOMAIN` and `VITE_CLASSIFICATION_INCLUDE_SUBDOMAINS=true` or `false`. They use the same hostname rules as the runtime fields.

Supply a valid `VITE_CLASSIFICATION_MAX_LEVEL` whenever using a build-time override. If `VITE_CLASSIFICATION_ALLOWED_LEVELS` is omitted, the build setting includes every option from `unclassified` through the maximum in application order. Supplying only a message or hostname does not create a complete configuration.

Vite embeds these values in the client bundle. Change them in the build environment, including the Docker builder stage, then rebuild. Setting them on an already-built static server does not change its JavaScript. Keep credentials and secrets out of both configuration methods.

## Precedence and loading

The resolver checks:

1. A valid build-time override matching the hostname.
2. A valid runtime override matching the hostname.
3. Hostname defaults.

A valid override scoped to a different hostname is skipped. Invalid build-time configuration produces an error even if its hostname would not match. The same validation-before-scope rule applies to the runtime file when no build-time override takes precedence. A runtime file must load successfully or explicitly select defaults before exports can use the runtime/default path.

The runtime request uses `/classification.config.json?deployment-policy=runtime`, with an additional `appRelease` parameter in release builds, to bypass the normal precache route. The service worker checks the network first and retains a policy response for offline use, with the packaged policy as an offline fallback.

An open tab retains its loaded policy; it does not poll for changes. After changing the deployed file, reload while connected and verify the options and a sample export. An explicit export retry also requests the runtime file again when a build-time override is not taking precedence. Runtime changes require no application rebuild in that case; disconnected clients cannot receive a new policy immediately.

Individual correspondence PDF, Word and TeX downloads, individual form PDFs and batch rows require a ready export policy. A loading failure pauses the export and offers retry. The editor's compatibility adapter can still display hostname defaults after an error, so a visible option alone does not establish that export policy loaded successfully.

## Verify a deployment

Use synthetic, unclassified test content:

1. Confirm the deployment's approved use and the permitted marking options with the responsible security authority.
2. Check the served config response and its JSON syntax.
3. Verify the actual hostname against any override scope.
4. Confirm which build-time values were used to produce the deployed bundle.
5. Reload, inspect the marking options, and export a sample document. Review its banners, portion marks and required designation or authority blocks.
6. Exercise the required offline behavior before disconnecting.

For a missing option, check precedence and hostname matching first. For a paused export, check the config request, JSON fields and deployment headers, then use Retry. Changing the runtime file will not override a matching build-time policy.

Implementation: `src/config/classification.ts` and `src/lib/exportDeploymentPolicy.ts`. Tests cover precedence, hostname matching, malformed settings, loading and retries. Hosting and asset preparation are covered in [deployment](DEPLOYMENT.md).
