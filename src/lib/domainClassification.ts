/**
 * Domain-based classification restrictions
 * Per DoD and IC security policies, classification levels are restricted
 * based on the domain from which the application is accessed.
 * 
 * Can be overridden via:
 * - Environment variables (VITE_CLASSIFICATION_*)
 * - Config file (public/classification.config.json)
 */

import { getClassificationConfigSync } from '@/config/classification';

export type ClassificationLevel = 
  | 'unclassified'
  | 'cui'
  | 'confidential'
  | 'secret'
  | 'top_secret'
  | 'top_secret_sci';

export interface ClassificationRestriction {
  maxLevel: ClassificationLevel;
  allowedLevels: ClassificationLevel[];
}

/**
 * Get the current domain from window.location
 */
export function getCurrentDomain(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.hostname;
}

/**
 * Determine the maximum allowed classification level based on domain
 * 
 * Rules (can be overridden via config):
 * - .smil.mil or .smil domains: up to SECRET
 * - .mil or .gov domains: up to CONFIDENTIAL or CUI
 * - .ic.gov domains: up to TOP SECRET (Intelligence Community)
 * - Other domains: Unclassified only
 */
export function getDomainClassificationRestriction(domain?: string): ClassificationRestriction {
  // Check for configuration override first (environment variables)
  const configOverride = getClassificationConfigSync();
  if (configOverride && configOverride.maxLevel && configOverride.allowedLevels) {
    const currentDomain = domain || getCurrentDomain();
    
    // If overrideDomain is set, check if it matches
    if (configOverride.overrideDomain) {
      // Check if current domain matches override domain
      if (currentDomain === configOverride.overrideDomain || 
          currentDomain.includes(configOverride.overrideDomain) ||
          configOverride.overrideDomain.includes(currentDomain)) {
        return {
          maxLevel: configOverride.maxLevel,
          allowedLevels: configOverride.allowedLevels,
        };
      }
      // If override domain is set but doesn't match, continue to domain detection
    } else {
      // No override domain specified, apply to all domains
      return {
        maxLevel: configOverride.maxLevel,
        allowedLevels: configOverride.allowedLevels,
      };
    }
  }

  const currentDomain = domain || getCurrentDomain();
  
  // Check for .smil.mil or .smil domains (Secure MIL)
  if (currentDomain.includes('.smil.mil') || currentDomain.endsWith('.smil')) {
    return {
      maxLevel: 'secret',
      allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'],
    };
  }
  
  // Check for .ic.gov domains (Intelligence Community)
  if (currentDomain.includes('.ic.gov')) {
    return {
      maxLevel: 'top_secret',
      allowedLevels: ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'],
    };
  }
  
  // Check for .mil or .gov domains
  if (currentDomain.endsWith('.mil') || currentDomain.endsWith('.gov')) {
    return {
      maxLevel: 'confidential',
      allowedLevels: ['unclassified', 'cui', 'confidential'],
    };
  }

  // Default: Unclassified and CUI only
  return {
    maxLevel: 'unclassified',
    allowedLevels: ['unclassified'],
  };
}

/**
 * Check if a classification level is allowed for the current domain
 */
export function isClassificationAllowed(
  level: ClassificationLevel,
  domain?: string
): boolean {
  const restriction = getDomainClassificationRestriction(domain);
  return restriction.allowedLevels.includes(level);
}

/**
 * Get a user-friendly message about domain restrictions
 */
export function getDomainRestrictionMessage(domain?: string): string {
  // Check for configuration override message
  const configOverride = getClassificationConfigSync();
  if (configOverride?.overrideMessage) {
    return configOverride.overrideMessage;
  }

  const currentDomain = domain || getCurrentDomain();
  
  if (currentDomain.includes('.smil.mil') || currentDomain.endsWith('.smil')) {
    return 'Secure Military domain detected. Classification up to SECRET is allowed.';
  }
  
  if (currentDomain.includes('.ic.gov')) {
    return 'Intelligence Community domain detected. All classification levels are allowed.';
  }
  
  if (currentDomain.endsWith('.mil') || currentDomain.endsWith('.gov')) {
    return 'Government domain detected. Classification up to CONFIDENTIAL or CUI is allowed.';
  }

  if (currentDomain === 'localhost') {
    return 'Development domain detected.';
  }
  
  return 'This is a non-government domain detected.';
}
