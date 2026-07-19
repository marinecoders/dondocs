import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/compressedStorage';
import { ACTION_ROUTING } from '@/data/actionRouting';

/**
 * Unit-specific overrides for the AA-form routing map. The bundled
 * `ACTION_ROUTING` is doctrine-level ("IPAC, or your S-1"); this store lets a
 * command save its *actual* routing per action type (e.g. "IPAC Bldg 100, SSgt
 * Cruz") so the suggestion reflects reality instead of doctrine. Overrides are
 * persisted locally and ride in the backup bundle, so an admin chief can
 * configure the command's routing once and share the backup with the unit.
 *
 * Keyed by the stable `ActionRoute.id`, so a default that gets re-worded still
 * carries the unit's override.
 */
interface RoutingState {
  /** routeId → the unit's destination for that action type. */
  overrides: Record<string, string>;
  setOverride: (id: string, destination: string) => void;
  clearOverride: (id: string) => void;
  resetOverrides: () => void;
}

export const useRoutingStore = create<RoutingState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (id, destination) =>
        set((s) => {
          const value = destination.trim();
          // An empty override is a clear, not a stored blank.
          if (!value) {
            if (!(id in s.overrides)) return s;
            const next = { ...s.overrides };
            delete next[id];
            return { overrides: next };
          }
          return { overrides: { ...s.overrides, [id]: value } };
        }),
      clearOverride: (id) =>
        set((s) => {
          if (!(id in s.overrides)) return s;
          const next = { ...s.overrides };
          delete next[id];
          return { overrides: next };
        }),
      resetOverrides: () => set({ overrides: {} }),
    }),
    {
      name: 'dondocs_routing',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);

/** Known route ids, for validating incoming overrides (e.g. from a backup). */
const KNOWN_IDS = new Set(ACTION_ROUTING.map((r) => r.id));

/** Keep only overrides that map to a known action type and a non-empty value. */
export function sanitizeOverrides(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (KNOWN_IDS.has(id) && typeof value === 'string' && value.trim()) out[id] = value.trim();
  }
  return out;
}
