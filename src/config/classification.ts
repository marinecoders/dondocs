/**
 * Classification configuration
 * 
 * This file can be overridden at build time using environment variables
 * or by providing a custom configuration file.
 * 
 * Environment Variables:
 * - VITE_CLASSIFICATION_MAX_LEVEL: Maximum allowed classification level
 *   (unclassified, cui, confidential, secret, top_secret, top_secret_sci)
 * - VITE_CLASSIFICATION_ALLOWED_LEVELS: Comma-separated list of allowed levels
 *   (e.g., "unclassified,cui,confidential,secret")
 * - VITE_CLASSIFICATION_OVERRIDE_DOMAIN: Override domain detection
 *   (e.g., "example.mil")
 * - VITE_CLASSIFICATION_OVERRIDE_MESSAGE: Custom restriction message
 * 
 * Config File:
 * Place a classification.config.json file in the public/ directory
 * with the following structure:
 * {
 *   "maxLevel": "secret",
 *   "allowedLevels": ["unclassified", "cui", "confidential", "secret"],
 *   "overrideDomain": "example.mil",
 *   "overrideMessage": "Custom deployment - Classification up to SECRET is allowed."
 * }
 */

import type { ClassificationLevel } from '@/lib/domainClassification';

export interface ClassificationConfig {
  maxLevel: ClassificationLevel;
  allowedLevels: ClassificationLevel[];
  overrideDomain?: string;
  overrideMessage?: string;
}

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): Partial<ClassificationConfig> | null {
  const maxLevel = import.meta.env.VITE_CLASSIFICATION_MAX_LEVEL as ClassificationLevel | undefined;
  const allowedLevelsStr = import.meta.env.VITE_CLASSIFICATION_ALLOWED_LEVELS as string | undefined;
  const overrideDomain = import.meta.env.VITE_CLASSIFICATION_OVERRIDE_DOMAIN as string | undefined;
  const overrideMessage = import.meta.env.VITE_CLASSIFICATION_OVERRIDE_MESSAGE as string | undefined;

  if (!maxLevel && !allowedLevelsStr && !overrideDomain) {
    return null;
  }

  const config: Partial<ClassificationConfig> = {};

  if (maxLevel) {
    config.maxLevel = maxLevel;
  }

  if (allowedLevelsStr) {
    const levels = allowedLevelsStr
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0) as ClassificationLevel[];
    if (levels.length > 0) {
      config.allowedLevels = levels;
    }
  } else if (maxLevel) {
    // If maxLevel is set but allowedLevels is not, generate allowed levels up to maxLevel
    const allLevels: ClassificationLevel[] = [
      'unclassified',
      'cui',
      'confidential',
      'secret',
      'top_secret',
      'top_secret_sci',
    ];
    const maxIndex = allLevels.indexOf(maxLevel);
    if (maxIndex >= 0) {
      config.allowedLevels = allLevels.slice(0, maxIndex + 1);
    }
  }

  if (overrideDomain) {
    config.overrideDomain = overrideDomain;
  }

  if (overrideMessage) {
    config.overrideMessage = overrideMessage;
  }

  return config;
}

/**
 * Load configuration from JSON file in public directory
 */
async function loadConfigFile(): Promise<Partial<ClassificationConfig> | null> {
  try {
    const response = await fetch('/classification.config.json');
    if (!response.ok) {
      return null;
    }
    const config = await response.json();
    return config as Partial<ClassificationConfig>;
  } catch {
    return null;
  }
}

let cachedConfig: ClassificationConfig | null = null;
let configLoadPromise: Promise<ClassificationConfig | null> | null = null;

/**
 * Get the classification configuration
 * Checks environment variables first, then config file, then defaults to domain detection
 */
export async function getClassificationConfig(): Promise<ClassificationConfig | null> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  // If already loading, return the same promise
  if (configLoadPromise) {
    return configLoadPromise;
  }

  // Load config
  configLoadPromise = (async () => {
    // Try environment variables first
    const envConfig = loadEnvConfig();
    if (envConfig && envConfig.maxLevel && envConfig.allowedLevels) {
      cachedConfig = {
        maxLevel: envConfig.maxLevel,
        allowedLevels: envConfig.allowedLevels,
        overrideDomain: envConfig.overrideDomain,
        overrideMessage: envConfig.overrideMessage,
      };
      return cachedConfig;
    }

    // Try config file
    const fileConfig = await loadConfigFile();
    if (fileConfig && fileConfig.maxLevel && fileConfig.allowedLevels) {
      cachedConfig = {
        maxLevel: fileConfig.maxLevel,
        allowedLevels: fileConfig.allowedLevels,
        overrideDomain: fileConfig.overrideDomain,
        overrideMessage: fileConfig.overrideMessage,
      };
      return cachedConfig;
    }

    // No override found
    return null;
  })();

  return configLoadPromise;
}

/**
 * Synchronously get classification config (for use in non-async contexts)
 * This will only return env-based config, not file-based config
 */
export function getClassificationConfigSync(): Partial<ClassificationConfig> | null {
  return loadEnvConfig();
}
