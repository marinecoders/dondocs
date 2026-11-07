import type { ClassificationLevel } from '@/lib/domainClassification';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { resolveExportDeploymentPolicy, type PolicyResolution, type RuntimePolicyState } from '@/lib/exportDeploymentPolicy';

export interface ClassificationConfig {
  maxLevel: ClassificationLevel;
  allowedLevels: ClassificationLevel[];
  overrideDomain?: string;
  includeSubdomains?: boolean;
  overrideMessage?: string;
}

/** Build settings precede a matching runtime file. Scopes are exact hosts
 * unless VITE_CLASSIFICATION_INCLUDE_SUBDOMAINS or includeSubdomains is true.
 */
export function getClassificationConfigSync(): Partial<ClassificationConfig> | null {
  const env = import.meta.env;
  const maxLevel = env.VITE_CLASSIFICATION_MAX_LEVEL;
  const allowed = env.VITE_CLASSIFICATION_ALLOWED_LEVELS;
  const overrideDomain = env.VITE_CLASSIFICATION_OVERRIDE_DOMAIN;
  const overrideMessage = env.VITE_CLASSIFICATION_OVERRIDE_MESSAGE;
  const subdomains = env.VITE_CLASSIFICATION_INCLUDE_SUBDOMAINS;
  if ([maxLevel, allowed, overrideDomain, overrideMessage, subdomains].every(value => value === undefined)) return null;
  const maxIndex = CLASSIFICATION_LEVELS.indexOf(maxLevel as ClassificationLevel);
  return {
    maxLevel: maxLevel as ClassificationLevel,
    allowedLevels: allowed === undefined ? CLASSIFICATION_LEVELS.slice(0, maxIndex + 1) : allowed.split(',').map((value: string) => value.trim()) as ClassificationLevel[],
    ...(overrideDomain === undefined ? {} : { overrideDomain }),
    ...(overrideMessage === undefined ? {} : { overrideMessage }),
    ...(subdomains === undefined ? {} : { includeSubdomains: subdomains === 'true' ? true : subdomains === 'false' ? false : subdomains as unknown as boolean }),
  };
}

let runtime: RuntimePolicyState = { status: 'not-loaded' };
let loading: Promise<void> | undefined;
async function loadRuntimePolicy(retry: boolean): Promise<void> {
  if (loading) return loading;
  if (!retry && runtime.status !== 'not-loaded') return;
  runtime = { status: 'loading' };
  loading = (async () => {
    try {
      const response = await fetch('/classification.config.json');
      if (response.status === 404) runtime = { status: 'absent' };
      else if (!response.ok) runtime = { status: 'failed' };
      else {
        const config: unknown = await response.json();
        runtime = config === null ? { status: 'absent' } : { status: 'loaded', config };
      }
    } catch { runtime = { status: 'failed' }; }
  })();
  try { await loading; } finally { loading = undefined; }
}

/** A null runtime file explicitly selects domain defaults and is precached for offline use.
 * Missing files remain distinct from unresolved, malformed, and failed loads. */
export async function getExportDeploymentPolicy(hostname = window.location.hostname, retry = false): Promise<PolicyResolution> {
  const environment = getClassificationConfigSync();
  const initial = resolveExportDeploymentPolicy({ hostname, environment, runtime });
  if (initial.status === 'ready' && initial.policy.source === 'environment') return initial;
  await loadRuntimePolicy(retry);
  return resolveExportDeploymentPolicy({ hostname, environment, runtime });
}

/** Compatibility adapter for the editor; exports consume the typed result. */
export async function getClassificationConfig(): Promise<ClassificationConfig | null> {
  const result = await getExportDeploymentPolicy();
  return result.status === 'ready' && result.policy.source !== 'domain' ? {
    maxLevel: result.policy.maxLevel, allowedLevels: [...result.policy.allowedLevels], overrideMessage: result.policy.message,
  } : null;
}
