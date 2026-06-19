/**
 * profileStore re-seeds DEFAULT_PROFILES on every hydration so a fresh install
 * always ships the canonical 'Marine Innovation Unit' (MIU) profile. The danger
 * is the inverse: a user who deletes or renames that default expects it to STAY
 * gone. Without the `hiddenDefaults` ledger the re-seed would resurrect it on the
 * next reload. These tests lock in that guard at two layers:
 *
 *   1. the actions (delete/rename) record the default name in hiddenDefaults, and
 *   2. the persist `merge` honors that ledger on rehydrate — a hidden default is
 *      NOT re-seeded, a non-hidden default IS, and a persisted profile that
 *      shadows a default name wins over the shipped copy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProfileStore } from '@/stores/profileStore';
import type { Profile } from '@/types/document';

const MIU = 'Marine Innovation Unit';
const STORAGE_KEY = 'dondocs_profiles';

// A minimal valid user profile distinct from the shipped MIU default.
function customProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    unitLine1: 'CUSTOM UNIT',
    unitLine2: 'CUSTOM COMMAND',
    unitAddress: '1 TEST ROAD',
    ssic: '1000',
    from: 'Commanding Officer, Custom Unit',
    sigFirst: '',
    sigMiddle: '',
    sigLast: '',
    sigRank: '',
    sigTitle: 'Commanding Officer',
    ...overrides,
  };
}

/**
 * Seed localStorage with a persisted state envelope, then drive the persist
 * middleware's merge() via a real rehydrate. The compressed storage adapter
 * reads non-"gz:" values straight through as plain JSON, so we can write a
 * readable object rather than a deflated blob. rehydrate() may be async, so
 * callers must await this.
 */
async function rehydrateFrom(state: {
  profiles: Record<string, Profile>;
  selectedProfile: string | null;
  hiddenDefaults: string[];
}): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
  await useProfileStore.persist.rehydrate();
}

describe('profileStore default-profile-resurrection guard', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to a clean shipped state so each test is order-independent: the
    // default MIU present, nothing hidden, no persisted overrides lingering
    // from a prior test's rehydrate.
    useProfileStore.setState({
      profiles: {
        [MIU]: {
          department: 'usmc',
          unitLine1: 'MARINE INNOVATION UNIT',
          unitLine2: 'MARINE FORCES RESERVE',
          unitAddress: '10 MCDONALD STREET, NEWBURGH, NY 12550',
          ssic: '5216',
          from: 'Commanding Officer, Marine Innovation Unit',
          sigFirst: '',
          sigMiddle: '',
          sigLast: '',
          sigRank: '',
          sigTitle: 'Commanding Officer',
          pocEmail: '',
        },
      },
      selectedProfile: MIU,
      hiddenDefaults: [],
    });
  });

  // ── Action layer ──────────────────────────────────────────────────────────

  it('deleteProfile removes a default and records it in hiddenDefaults', () => {
    useProfileStore.getState().deleteProfile(MIU);

    const { profiles, hiddenDefaults } = useProfileStore.getState();
    expect(profiles[MIU]).toBeUndefined();
    expect(hiddenDefaults).toContain(MIU);
  });

  it('deleting a default twice does not duplicate it in hiddenDefaults', () => {
    useProfileStore.getState().deleteProfile(MIU);
    // Re-add then delete again to confirm the ledger dedupes.
    useProfileStore.getState().addProfile(MIU, customProfile());
    useProfileStore.getState().deleteProfile(MIU);

    const { hiddenDefaults } = useProfileStore.getState();
    expect(hiddenDefaults.filter((n) => n === MIU)).toHaveLength(1);
  });

  it('renameProfile keeps the new name and hides the original default', () => {
    useProfileStore.getState().renameProfile(MIU, 'My Unit');

    const { profiles, hiddenDefaults } = useProfileStore.getState();
    expect(profiles['My Unit']).toBeDefined();
    expect(profiles[MIU]).toBeUndefined();
    // The original default name is recorded so the re-seed won't bring it back
    // alongside the renamed copy.
    expect(hiddenDefaults).toContain(MIU);
  });

  it('renaming a non-default profile does not touch hiddenDefaults', () => {
    useProfileStore.getState().addProfile('Alpha', customProfile());
    useProfileStore.getState().renameProfile('Alpha', 'Beta');

    const { profiles, hiddenDefaults } = useProfileStore.getState();
    expect(profiles['Beta']).toBeDefined();
    expect(hiddenDefaults).not.toContain('Alpha');
    expect(hiddenDefaults).not.toContain('Beta');
  });

  // ── Merge layer (persist rehydrate) ───────────────────────────────────────

  it('does NOT resurrect a hidden default on rehydrate, and keeps custom profiles', async () => {
    await rehydrateFrom({
      profiles: { Alpha: customProfile() },
      selectedProfile: null,
      hiddenDefaults: [MIU],
    });

    const { profiles } = useProfileStore.getState();
    // The deleted default stays gone...
    expect(profiles[MIU]).toBeUndefined();
    // ...and the user's own profile survives the merge.
    expect(profiles['Alpha']).toBeDefined();
  });

  it('re-seeds a non-hidden default on rehydrate', async () => {
    await rehydrateFrom({
      profiles: { Alpha: customProfile() },
      selectedProfile: null,
      hiddenDefaults: [],
    });

    const { profiles } = useProfileStore.getState();
    // Nothing is hidden, so the shipped MIU default is seeded back in...
    expect(profiles[MIU]).toBeDefined();
    // ...alongside the persisted custom profile.
    expect(profiles['Alpha']).toBeDefined();
  });

  it('lets a persisted profile shadowing a default name win over the shipped copy', async () => {
    const shadow = customProfile({ from: 'Commanding Officer, USER OVERRIDE' });
    await rehydrateFrom({
      profiles: { [MIU]: shadow },
      selectedProfile: null,
      hiddenDefaults: [],
    });

    const { profiles } = useProfileStore.getState();
    expect(profiles[MIU]).toBeDefined();
    // The persisted (custom) profile is spread AFTER defaults, so it wins:
    // the user's override survives rather than the shipped default clobbering it.
    expect(profiles[MIU].from).toBe('Commanding Officer, USER OVERRIDE');
    expect(profiles[MIU].unitLine1).toBe('CUSTOM UNIT');
  });
});
