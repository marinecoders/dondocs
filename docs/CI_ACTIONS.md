# CI action references

Every external GitHub action and reusable workflow under `.github/workflows/` uses a full commit SHA. Version comments identify the previously selected tag; pinning does not change Node versions, action majors, permissions or release triggers. The SBOM job deliberately retains checkout v6 while the other checkout steps retain v7.

## Current upstream pins

Resolved on 2026-11-13 from the official upstream repositories with `git ls-remote`, using the peeled commit (`^{}`) for annotated tags. Each commit was also checked through that upstream repository’s GitHub commit API.

| Upstream reference | Verified commit |
| --- | --- |
| `actions/cache@v6` | [`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`](https://github.com/actions/cache/commit/55cc8345863c7cc4c66a329aec7e433d2d1c52a9) |
| `actions/checkout@v6` | [`d23441a48e516b6c34aea4fa41551a30e30af803`](https://github.com/actions/checkout/commit/d23441a48e516b6c34aea4fa41551a30e30af803) |
| `actions/checkout@v7` | [`3d3c42e5aac5ba805825da76410c181273ba90b1`](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1) |
| `actions/github-script@v9` | [`3a2844b7e9c422d3c10d287c895573f7108da1b3`](https://github.com/actions/github-script/commit/3a2844b7e9c422d3c10d287c895573f7108da1b3) |
| `actions/setup-node@v6` | [`249970729cb0ef3589644e2896645e5dc5ba9c38`](https://github.com/actions/setup-node/commit/249970729cb0ef3589644e2896645e5dc5ba9c38) |
| `actions/upload-artifact@v7` | [`cf430e030ddbb5b0abf93d22962f4752f3646cd9`](https://github.com/actions/upload-artifact/commit/cf430e030ddbb5b0abf93d22962f4752f3646cd9) |
| `cloudflare/wrangler-action@v3` | [`9acf94ace14e7dc412b076f2c5c20b8ce93c79cd`](https://github.com/cloudflare/wrangler-action/commit/9acf94ace14e7dc412b076f2c5c20b8ce93c79cd) |
| `docker/build-push-action@v5` | [`ca052bb54ab0790a636c9b5f226502c73d547a25`](https://github.com/docker/build-push-action/commit/ca052bb54ab0790a636c9b5f226502c73d547a25) |
| `docker/login-action@v3` | [`c94ce9fb468520275223c153574b00df6fe4bcc9`](https://github.com/docker/login-action/commit/c94ce9fb468520275223c153574b00df6fe4bcc9) |
| `docker/metadata-action@v5` | [`c299e40c65443455700f0fdfc63efafe5b349051`](https://github.com/docker/metadata-action/commit/c299e40c65443455700f0fdfc63efafe5b349051) |
| `docker/setup-buildx-action@v3` | [`8d2750c68a42422c14e847fe6c8ac0403b4cbd6f`](https://github.com/docker/setup-buildx-action/commit/8d2750c68a42422c14e847fe6c8ac0403b4cbd6f) |

The seven workflows covered are test, release, managed publication, Docker release, release qualification, tracker sync and scheduled/manual cartesian checks. The managed publication workflow calls `./.github/workflows/qualify-release.yml` from the same commit.

## Enforcement

Run `npm run check:ci-actions`. The pull-request and main-branch test workflow runs the same command in its **immutable CI references** job. It executes positive and negative fixtures, then parses every `.yml` and `.yaml` workflow using the explicitly declared, lockfile-backed `js-yaml` dependency. It checks job-level reusable workflow calls and step-level action calls, including YAML aliases, quoted values, flow mappings and multiline scalars. Invalid YAML and duplicate keys fail. Shell text is not treated as an action reference.

External references require exactly 40 hexadecimal commit characters. Branches, tags, shortened hashes and expressions are rejected. `docker://` action references require an explicit `@sha256:` digest with 64 hexadecimal characters; an image tag alone is rejected. There are currently no Docker action references in these workflows. Container base images and images built by Docker commands are outside this action-reference check.

Local `./` references are deliberate same-commit dependencies. Reusable workflows must be under `.github/workflows/`; local actions must contain `action.yml` or `action.yaml`. The check follows local composite actions recursively, checking their `uses` references too. Missing local files, path traversal and symlinks escaping the checkout fail. Cycles are visited once. Local action code and any Dockerfiles still require normal review.

## Reviewing updates

Review action pins when adopting an upstream release or addressing an upstream security fix. There is no action-update bot or scheduled maintainer review configured in this repository. Propose updates in a focused pull request:

1. Review the official upstream release notes, changed code and runtime requirements for the currently selected major. Keep unrelated toolchain or major upgrades in separate changes.
2. Resolve the intended upstream tag, for example `git ls-remote https://github.com/actions/checkout.git refs/tags/v7 'refs/tags/v7^{}'`. If a peeled line is present, use its commit SHA rather than the annotated tag object.
3. Verify the commit belongs to that upstream repository, for example `gh api repos/actions/checkout/commits/COMMIT --jq .sha`. Check that its source matches the intended release.
4. Replace every intended occurrence of that action SHA and its readable version comment; update this inventory and record any exceptions such as the separate checkout v6 pin.
5. Run `npm run check:ci-actions`, the normal repository checks and nonpublishing pull-request CI. Review workflow permissions, runtime versions and release triggers in the diff. Release and publish workflows must not be run merely to validate an action update.

The gate validates immutable reference syntax and local resolution. Upstream ownership, provenance and source-code review remain part of the maintainer update review.
