import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LICENSE_BANNER = `/*! DonDocs - Copyright (c) 2026 Roberto Chiofalo.
 * DonDocs code: SPDX-License-Identifier: AGPL-3.0-only
 * See LICENSE.txt, THIRD_PARTY_LICENSES.txt, and SOURCE.txt.
 * Third-party components retain their own licenses. Provided without warranty.
 */`;

/** Shared legal files for web, companion, and MCP bundle distributions. */
export function licenseNotices(root: string): Record<string, string> {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  let ref = `v${version}`;
  try {
    ref = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
    }).trim();
  } catch {
    // Source archives and Docker builds have no .git directory. Releases
    // publish a matching version tag; see docs/LICENSING.md for fork guidance.
  }
  const repository = 'https://github.com/marinecoders/dondocs';
  return {
    'LICENSE.txt': readFileSync(join(root, 'LICENSE'), 'utf8'),
    'THIRD_PARTY_LICENSES.txt': readFileSync(join(root, 'THIRD_PARTY_LICENSES.md'), 'utf8'),
    'LICENSING.txt': readFileSync(join(root, 'docs/LICENSING.md'), 'utf8'),
    'SOURCE.txt': [
      `DonDocs ${version} — source reference: ${ref}`,
      '',
      `Browse source: ${repository}/tree/${ref}`,
      `Download source: ${repository}/archive/${ref}.tar.gz`,
      '',
      'Build instructions: README.md and docs/COMPANION.md in the source archive.',
      'See LICENSING.txt and THIRD_PARTY_LICENSES.txt for source-distribution requirements.',
      'Modified deployments must provide their actual corresponding source, including',
      'required dependency source and build scripts; an upstream link alone is insufficient.',
      '',
    ].join('\n'),
  };
}
