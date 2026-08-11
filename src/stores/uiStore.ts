import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/compressedStorage';
import type { StorageHealth } from '@/lib/documentsDb';

export type DensityMode = 'compact' | 'comfortable' | 'spacious';
export type ColorScheme = 'default' | 'navy' | 'usmc';

/**
 * Sidebar geometry, in px.
 *
 * `min` is where the widest section label ("Classification") still fits beside
 * its icon; `max` keeps the editor column usable on a 1280 screen once the
 * preview is open. `collapsed` is the icon rail, which the resizer snaps to
 * rather than treating as a separate mode — see SidebarResizer.
 */
export const SIDEBAR_WIDTH = {
  min: 200,
  max: 420,
  default: 248,
  collapsed: 52,
  /** Drag narrower than this and it snaps shut instead of leaving a stub. */
  snapThreshold: 160,
} as const;

/**
 * What a pointer `x` px from the viewport's left edge means for the sidebar.
 *
 * Collapsing is the bottom of this range rather than a separate mode: drag past
 * the threshold and it snaps to the rail, drag back out and the width returns.
 * Lives here beside the geometry it depends on, and stays pure so the behaviour
 * is testable without a DOM.
 */
export function resolveSidebarDrag(x: number): { collapsed: boolean; width?: number } {
  if (x < SIDEBAR_WIDTH.snapThreshold) return { collapsed: true };
  return {
    collapsed: false,
    width: Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, x)),
  };
}

/**
 * The sidebar's other axis: how its height is split between the section
 * outline on top and Recents underneath.
 *
 * Only the floors live here. The outline's height is otherwise CSS — content
 * height by default, capped so Recents always keeps `minRecents` — because the
 * cap has to hold when the window resizes, not only when someone drags.
 */
export const SIDEBAR_SPLIT = {
  /** The outline's floor: its label row and a couple of sections. */
  minOutline: 96,
  /** Recents' floor: header + search + one row, which is where it stops being a list. */
  minRecents: 140,
} as const;

/**
 * The outline height for a pointer `y`, given where the outline starts and how
 * much room the sidebar has. Pure, like resolveSidebarDrag, so the clamping is
 * testable without a DOM — and clamped against the container rather than a
 * constant, since the ceiling moves with the window.
 */
export function resolveSplitDrag(y: number, outlineTop: number, containerHeight: number): number {
  const ceiling = Math.max(SIDEBAR_SPLIT.minOutline, containerHeight - SIDEBAR_SPLIT.minRecents);
  return Math.max(SIDEBAR_SPLIT.minOutline, Math.min(ceiling, y - outlineTop));
}

/** The system's preferred color scheme, for first-time users with no preference set. */
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light'; // Fallback for SSR or unsupported browsers
}

interface UIState {
  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;

  // Color Scheme
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;

  // Density
  density: DensityMode;
  setDensity: (density: DensityMode) => void;

  // Preview panel
  previewVisible: boolean;
  previewWidth: number; // percentage (0-100)
  togglePreview: () => void;
  setPreviewVisible: (visible: boolean) => void;
  setPreviewWidth: (width: number) => void;
  /** PDF viewer thumbnail rail (only offered on 2+ page documents). */
  pdfThumbnailsOpen: boolean;
  setPdfThumbnailsOpen: (open: boolean) => void;

  // Modals
  profileModalOpen: boolean;
  restoreModalOpen: boolean;
  referenceLibraryOpen: boolean;
  aboutModalOpen: boolean;
  nistModalOpen: boolean;
  /** Endpoint reachability check. Deliberately absent from `partialize`:
   *  nothing it holds is worth carrying across a reload. */
  connectivityModalOpen: boolean;
  batchModalOpen: boolean;
  importLetterModalOpen: boolean;
  commandPaletteOpen: boolean;
  findReplaceOpen: boolean;
  templateLoaderOpen: boolean;
  piiWarningOpen: boolean;
  structureWarningOpen: boolean;
  documentGuideOpen: boolean;
  /** The Document Guide's active tab, in the store so the activation checklist
   *  can deep-link to a tab before opening it. */
  documentGuideTab: 'finder' | 'browse' | 'examples' | 'features';
  /** 'share' | 'import' when open, null when closed */
  shareModal: 'share' | 'import' | null;
  /** The header Save dropdown, controlled here so a guided walkthrough can hold
   *  it open and spotlight the backup items inside it. Session-only. */
  saveMenuOpen: boolean;
  setSaveMenuOpen: (open: boolean) => void;
  /** Mobile-only getting-started sheet (the floating checklist card collides
   *  with the Preview FAB on phones, so mobile gets a bottom sheet opened from
   *  the menu instead). Session-only. */
  checklistSheetOpen: boolean;
  setChecklistSheetOpen: (open: boolean) => void;
  setProfileModalOpen: (open: boolean) => void;
  setRestoreModalOpen: (open: boolean) => void;
  setShareModal: (mode: 'share' | 'import' | null) => void;
  setReferenceLibraryOpen: (open: boolean) => void;
  setAboutModalOpen: (open: boolean) => void;
  setConnectivityModalOpen: (open: boolean) => void;
  setNistModalOpen: (open: boolean) => void;
  setBatchModalOpen: (open: boolean) => void;
  setImportLetterModalOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setFindReplaceOpen: (open: boolean) => void;
  setTemplateLoaderOpen: (open: boolean) => void;
  setPiiWarningOpen: (open: boolean) => void;
  setStructureWarningOpen: (open: boolean) => void;
  setDocumentGuideOpen: (open: boolean) => void;
  setDocumentGuideTab: (tab: UIState['documentGuideTab']) => void;

  // Documents sidebar (recents + section outline)
  sidebarCollapsed: boolean;
  /**
   * Sidebar width in px. Pixels rather than a percentage because its content is
   * text at a fixed size — a section label needs the same room on a 13" laptop
   * as on a 27" display, where a percentage would give it three times as much.
   */
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  /** Outline height in px; null means fit its content, which is the default. */
  outlineHeight: number | null;
  setOutlineHeight: (height: number | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Mobile
  isMobile: boolean;
  setIsMobile: (mobile: boolean) => void;
  mobilePreviewOpen: boolean;
  setMobilePreviewOpen: (open: boolean) => void;
  // Mobile-only Recents drawer (the desktop sidebar is hidden on small screens).
  mobileDocsOpen: boolean;
  setMobileDocsOpen: (open: boolean) => void;
  // Version-history modal: the document id whose snapshots to show (null = closed).
  historyDocId: string | null;
  setHistoryDocId: (id: string | null) => void;

  // Preview quality
  fullQualityPreview: boolean;
  setFullQualityPreview: (enabled: boolean) => void;

  // Set whenever the current document is actually persisted; drives the passive
  // "Saved" indicator. Session-only UI state (not persisted).
  lastSavedAt: number | null;
  // In-flight persistence state, so the indicator can show "Saving…" and a real
  // "Couldn't save" instead of always claiming "Saved".
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  markSaved: () => void;
  setSaveStatus: (s: 'idle' | 'saving' | 'saved' | 'error') => void;
  // Point the indicator at a specific time (a switched-in doc's last save) or
  // null (a brand-new, never-saved doc) so "Saved · …" reflects THIS document.
  setLastSavedAt: (ts: number | null) => void;

  // Drives the section rail's error dots; nothing flags until the first export
  // attempt.
  validationVisible: boolean;
  setValidationVisible: (visible: boolean) => void;

  // How durable local storage is in this browser (probed once at startup); drives
  // the storage-health notice. Not persisted — recomputed each session.
  storageHealth: StorageHealth;
  setStorageHealth: (health: StorageHealth) => void;
  // The health level the user dismissed the notice for (persisted). Keyed to the
  // level so dismissing the milder 'evictable' notice doesn't also hide a later,
  // more serious 'unavailable' one.
  storageNoticeDismissed: StorageHealth | null;
  dismissStorageNotice: () => void;

  // Close all modals (for Escape key)
  closeAllModals: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Theme - detect system preference for first-time users
      theme: getSystemTheme(),
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'dark' ? 'light' : 'dark',
      })),
      setTheme: (theme) => set({ theme }),

      // Color Scheme - Default (Marines.dev branded: USMC Red primary, navy backgrounds)
      colorScheme: 'default',
      setColorScheme: (colorScheme) => set({ colorScheme }),

      // Density - default comfortable
      density: 'comfortable',
      setDensity: (density) => set({ density }),

      // Preview - hidden by default, form gets full width
      previewVisible: false,
      previewWidth: 35,
      togglePreview: () => set((state) => ({ previewVisible: !state.previewVisible })),
      setPreviewVisible: (visible) => set({ previewVisible: visible }),
      setPreviewWidth: (width) => set({ previewWidth: Math.max(20, Math.min(80, width)) }),
      pdfThumbnailsOpen: false,
      setPdfThumbnailsOpen: (open) => set({ pdfThumbnailsOpen: open }),

      // Modals
      profileModalOpen: false,
      restoreModalOpen: false,
      referenceLibraryOpen: false,
      aboutModalOpen: false,
      nistModalOpen: false,
      connectivityModalOpen: false,
      batchModalOpen: false,
      importLetterModalOpen: false,
      commandPaletteOpen: false,
      findReplaceOpen: false,
      templateLoaderOpen: false,
      piiWarningOpen: false,
      structureWarningOpen: false,
      documentGuideOpen: false,
      documentGuideTab: 'browse',
      shareModal: null,
      saveMenuOpen: false,
      setSaveMenuOpen: (open) => set({ saveMenuOpen: open }),
      checklistSheetOpen: false,
      setChecklistSheetOpen: (open) => set({ checklistSheetOpen: open }),
      setProfileModalOpen: (open) => set({ profileModalOpen: open }),
      setRestoreModalOpen: (open) => set({ restoreModalOpen: open }),
      setShareModal: (mode) => set({ shareModal: mode }),
      setReferenceLibraryOpen: (open) => set({ referenceLibraryOpen: open }),
      setAboutModalOpen: (open) => set({ aboutModalOpen: open }),
      setConnectivityModalOpen: (open) => set({ connectivityModalOpen: open }),
      setNistModalOpen: (open) => set({ nistModalOpen: open }),
      setBatchModalOpen: (open) => set({ batchModalOpen: open }),
      setImportLetterModalOpen: (open) => set({ importLetterModalOpen: open }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setFindReplaceOpen: (open) => set({ findReplaceOpen: open }),
      setTemplateLoaderOpen: (open) => set({ templateLoaderOpen: open }),
      setPiiWarningOpen: (open) => set({ piiWarningOpen: open }),
      setStructureWarningOpen: (open) => set({ structureWarningOpen: open }),
      setDocumentGuideOpen: (open) => set({ documentGuideOpen: open }),
      setDocumentGuideTab: (tab) => set({ documentGuideTab: tab }),

      // Documents sidebar - expanded by default on desktop
      sidebarCollapsed: false,
      // 248 was the hard-coded width before this became adjustable, so an
      // existing user sees nothing move until they drag it.
      sidebarWidth: SIDEBAR_WIDTH.default,
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, width)) }),
      outlineHeight: null,
      setOutlineHeight: (height) =>
        set({ outlineHeight: height === null ? null : Math.max(SIDEBAR_SPLIT.minOutline, height) }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      // Mobile
      isMobile: false,
      setIsMobile: (mobile) => set({ isMobile: mobile }),
      mobilePreviewOpen: false,
      setMobilePreviewOpen: (open) => set({ mobilePreviewOpen: open }),
      mobileDocsOpen: false,
      setMobileDocsOpen: (open) => set({ mobileDocsOpen: open }),
      historyDocId: null,
      setHistoryDocId: (id) => set({ historyDocId: id }),

      // Preview quality - off by default for performance
      fullQualityPreview: false,
      setFullQualityPreview: (enabled) => set({ fullQualityPreview: enabled }),

      // Auto-save indicator
      lastSavedAt: null,
      saveStatus: 'idle',
      markSaved: () => set({ lastSavedAt: Date.now(), saveStatus: 'saved' }),
      setSaveStatus: (s) => set({ saveStatus: s }),
      setLastSavedAt: (ts) => set({ lastSavedAt: ts, saveStatus: ts == null ? 'idle' : 'saved' }),

      // Validation visibility
      validationVisible: false,
      setValidationVisible: (visible) => set({ validationVisible: visible }),

      // Storage durability (probed at startup) + one-time notice dismissal
      storageHealth: 'ok',
      setStorageHealth: (storageHealth) => set({ storageHealth }),
      storageNoticeDismissed: null,
      dismissStorageNotice: () => set((s) => ({ storageNoticeDismissed: s.storageHealth })),

      // Close all modals
      closeAllModals: () => set({
        profileModalOpen: false,
        restoreModalOpen: false,
        referenceLibraryOpen: false,
        aboutModalOpen: false,
        nistModalOpen: false,
        batchModalOpen: false,
        importLetterModalOpen: false,
        commandPaletteOpen: false,
        findReplaceOpen: false,
        templateLoaderOpen: false,
        documentGuideOpen: false,
        mobilePreviewOpen: false,
        mobileDocsOpen: false,
        historyDocId: null,
        shareModal: null,
        // piiWarningOpen is not closed by Escape, to avoid dismissing a security
        // warning by accident. structureWarningOpen is left out for a different
        // reason: the export it interrupted is parked in a ref, and closing the
        // flag without running the modal's own cancel would strand it. Its
        // Dialog handles Escape itself, which does route through cancel.
      }),
    }),
    {
      name: 'dondocs_ui',
      // Guarded storage so a boot-time set() can't throw under blocked site data.
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        theme: state.theme,
        colorScheme: state.colorScheme,
        density: state.density,
        previewVisible: state.previewVisible,
        previewWidth: state.previewWidth,
        pdfThumbnailsOpen: state.pdfThumbnailsOpen,
        fullQualityPreview: state.fullQualityPreview,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
        outlineHeight: state.outlineHeight,
        storageNoticeDismissed: state.storageNoticeDismissed,
      }),
    }
  )
);
