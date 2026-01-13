/**
 * Stores barrel export
 *
 * Central export point for all Zustand stores.
 * Import from '@/stores' instead of individual files.
 */

export { useDocumentStore } from './documentStore';
export { useHistoryStore, type DocumentSnapshot } from './historyStore';
export { useLogStore, type LogEntry } from './logStore';
export { useProfileStore } from './profileStore';
export { useUIStore, type DensityMode, type ColorScheme } from './uiStore';
