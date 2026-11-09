import type { ClassificationLevel } from './domainClassification';
import { CLASSIFICATION_LEVELS, classificationRank } from './overallClassification';

export interface DeploymentConfig {
  readonly maxLevel: ClassificationLevel;
  readonly allowedLevels: readonly ClassificationLevel[];
  readonly overrideDomain?: string;
  readonly includeSubdomains?: boolean;
  readonly overrideMessage?: string;
}
export type RuntimePolicyState =
  | { readonly status: 'not-loaded' | 'loading' | 'absent' | 'failed' }
  | { readonly status: 'loaded'; readonly config: unknown };
const policyBrand = Symbol('deployment-policy');
export interface ExportDeploymentPolicy {
  readonly [policyBrand]: true;
  readonly identity: string;
  readonly hostname: string;
  readonly source: 'environment' | 'runtime' | 'domain';
  readonly maxLevel: ClassificationLevel;
  readonly allowedLevels: readonly ClassificationLevel[];
  readonly message: string;
}
export type PolicyResolution =
  | { readonly status: 'ready'; readonly policy: ExportDeploymentPolicy }
  | { readonly status: 'not-ready' | 'error'; readonly message: string };
const issuedPolicies = new WeakSet<ExportDeploymentPolicy>();

/** Accept hostnames, including browser IPv6 literals, rather than URLs or ports. */
export function normalizePolicyHostname(value: string): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim().replace(/\.$/, '');
  if (!input || /[\s/%?#@\\]/.test(input)) return null;
  try {
    const url = new URL(`http://${input}`);
    if (url.port || url.pathname !== '/' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host.startsWith('[')) return input.startsWith('[') && input.endsWith(']') ? host : null;
    if (input.includes(':') || host.length > 253) return null;
    return host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) ? host : null;
  } catch { return null; }
}

export function matchesPolicyHostname(hostname: string, domain: string, includeSubdomains = false): boolean {
  const host = normalizePolicyHostname(hostname);
  const parent = normalizePolicyHostname(domain);
  return host !== null && parent !== null && (host === parent || includeSubdomains && host.endsWith(`.${parent}`));
}

function parseConfig(value: unknown): DeploymentConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid deployment configuration.');
  const config = value as Record<string, unknown>;
  const rank = typeof config.maxLevel === 'string' ? classificationRank(config.maxLevel) : undefined;
  if (rank === undefined || !Array.isArray(config.allowedLevels) || !config.allowedLevels.length
    || config.allowedLevels.some(level => typeof level !== 'string' || classificationRank(level) === undefined || classificationRank(level)! > rank)) {
    throw new Error('Deployment configuration needs valid allowed levels within its maximum.');
  }
  if (!config.allowedLevels.includes('unclassified') || !config.allowedLevels.includes(config.maxLevel)) {
    throw new Error('Deployment configuration must include unclassified and its maximum level.');
  }
  if (config.overrideDomain !== undefined && (typeof config.overrideDomain !== 'string' || !normalizePolicyHostname(config.overrideDomain))) throw new Error('Deployment overrideDomain must be a hostname.');
  if (config.includeSubdomains !== undefined && typeof config.includeSubdomains !== 'boolean') throw new Error('includeSubdomains must be boolean.');
  if (config.includeSubdomains === true && !config.overrideDomain) throw new Error('Subdomain matching needs an overrideDomain.');
  if (config.overrideMessage !== undefined && typeof config.overrideMessage !== 'string') throw new Error('Invalid deployment message.');
  return {
    maxLevel: config.maxLevel as ClassificationLevel,
    allowedLevels: Object.freeze(CLASSIFICATION_LEVELS.filter(level => (config.allowedLevels as unknown[]).includes(level))),
    ...(config.overrideDomain ? { overrideDomain: normalizePolicyHostname(config.overrideDomain as string)! } : {}),
    includeSubdomains: config.includeSubdomains === true,
    overrideMessage: config.overrideMessage as string | undefined,
  };
}

function domainDefault(host: string): DeploymentConfig {
  if (matchesPolicyHostname(host, 'smil.mil', true) || matchesPolicyHostname(host, 'smil', true)) return { maxLevel: 'secret', allowedLevels: CLASSIFICATION_LEVELS.slice(0, 4), overrideMessage: 'Deployment settings allow markings up to SECRET.' };
  if (matchesPolicyHostname(host, 'ic.gov', true)) return { maxLevel: 'top_secret_sci', allowedLevels: CLASSIFICATION_LEVELS, overrideMessage: 'Deployment settings allow all configured marking levels.' };
  if (host.endsWith('.mil') || host.endsWith('.gov')) return { maxLevel: 'confidential', allowedLevels: CLASSIFICATION_LEVELS.slice(0, 3), overrideMessage: 'Deployment settings allow markings up to CONFIDENTIAL.' };
  return { maxLevel: 'unclassified', allowedLevels: ['unclassified'], overrideMessage: host === 'localhost' ? 'Development domain detected.' : 'Non-government domain: deployment settings allow UNCLASSIFIED.' };
}

/** Environment > runtime file > domain defaults, considering only matching scopes.
 * A hostname chooses local configuration; it does not establish accreditation.
 */
export function resolveExportDeploymentPolicy(input: { hostname: string; environment: unknown | null; runtime: RuntimePolicyState }): PolicyResolution {
  const hostname = normalizePolicyHostname(input.hostname);
  if (!hostname) return Object.freeze({ status: 'error', message: 'The deployment hostname is invalid.' });
  try {
    const environment = input.environment === null ? null : parseConfig(input.environment);
    let source: ExportDeploymentPolicy['source'] = 'environment';
    let config = environment && (!environment.overrideDomain || matchesPolicyHostname(hostname, environment.overrideDomain, environment.includeSubdomains)) ? environment : null;
    if (!config) {
      if (input.runtime.status === 'loading' || input.runtime.status === 'not-loaded') return Object.freeze({ status: 'not-ready', message: 'Deployment policy is still loading.' });
      if (input.runtime.status === 'failed') return Object.freeze({ status: 'error', message: 'Deployment policy could not be loaded. Retry loading it before export.' });
      if (input.runtime.status !== 'absent' && input.runtime.status !== 'loaded') throw new Error('Invalid deployment policy load state.');
      const runtime = input.runtime.status === 'loaded' ? parseConfig(input.runtime.config) : null;
      config = runtime && (!runtime.overrideDomain || matchesPolicyHostname(hostname, runtime.overrideDomain, runtime.includeSubdomains)) ? runtime : null;
      source = config ? 'runtime' : 'domain';
    }
    config ??= domainDefault(hostname);
    const data = { hostname, source, maxLevel: config.maxLevel, allowedLevels: Object.freeze([...config.allowedLevels]), message: config.overrideMessage ?? 'Deployment marking settings applied.' };
    const policy: ExportDeploymentPolicy = Object.freeze({ [policyBrand]: true as const, ...data, identity: JSON.stringify([data, config.overrideDomain, config.includeSubdomains]) });
    issuedPolicies.add(policy);
    return Object.freeze({ status: 'ready', policy });
  } catch (error) { return Object.freeze({ status: 'error', message: error instanceof Error ? error.message : 'Invalid deployment policy.' }); }
}

export function assertExportDeploymentPolicy(policy: ExportDeploymentPolicy): void {
  if (!issuedPolicies.has(policy)) throw new Error('Deployment policy must be issued by the policy resolver.');
}
