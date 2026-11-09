import { getClassificationConfigSync } from '@/config/classification';
import { resolveExportDeploymentPolicy } from './exportDeploymentPolicy';

export type ClassificationLevel = 'unclassified' | 'cui' | 'confidential' | 'secret' | 'top_secret' | 'top_secret_sci';
export interface ClassificationRestriction { maxLevel: ClassificationLevel; allowedLevels: ClassificationLevel[] }
export function getCurrentDomain(): string { return typeof window === 'undefined' ? '' : window.location.hostname; }
function resolveDomain(domain: string | undefined) {
  return resolveExportDeploymentPolicy({ hostname: domain ?? getCurrentDomain(), environment: getClassificationConfigSync(), runtime: { status: 'absent' } });
}
export function getDomainClassificationRestriction(domain?: string): ClassificationRestriction {
  const result = resolveDomain(domain);
  return result.status === 'ready' ? { maxLevel: result.policy.maxLevel, allowedLevels: [...result.policy.allowedLevels] }
    : { maxLevel: 'unclassified', allowedLevels: ['unclassified'] };
}
export function isClassificationAllowed(level: ClassificationLevel, domain?: string): boolean {
  return getDomainClassificationRestriction(domain).allowedLevels.includes(level);
}
export function getDomainRestrictionMessage(domain?: string): string {
  const result = resolveDomain(domain);
  return result.status === 'ready' ? result.policy.message : result.message;
}
