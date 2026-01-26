import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DensityMode = 'compact' | 'comfortable' | 'spacious';
export type ColorScheme = 'default' | 'navy' | 'usmc';

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

  // Modals
  profileModalOpen: boolean;
  restoreModalOpen: boolean;
  referenceLibraryOpen: boolean;
  aboutModalOpen: boolean;
  nistModalOpen: boolean;
  batchModalOpen: boolean;
  findReplaceOpen: boolean;
  templateLoaderOpen: boolean;
  piiWarningOpen: boolean;
  documentGuideOpen: boolean;
  /** 'share' | 'import' when open, null when closed */
  shareModal: 'share' | 'import' | null;
  setProfileModalOpen: (open: boolean) => void;
  setRestoreModalOpen: (open: boolean) => void;
  setShareModal: (mode: 'share' | 'import' | null) => void;
  setReferenceLibraryOpen: (open: boolean) => void;
  setAboutModalOpen: (open: boolean) => void;
  setNistModalOpen: (open: boolean) => void;
  setBatchModalOpen: (open: boolean) => void;
  setFindReplaceOpen: (open: boolean) => void;
  setTemplateLoaderOpen: (open: boolean) => void;
  setPiiWarningOpen: (open: boolean) => void;
  setDocumentGuideOpen: (open: boolean) => void;

  // Mobile
  isMobile: boolean;
  setIsMobile: (mobile: boolean) => void;
  mobilePreviewOpen: boolean;
  setMobilePreviewOpen: (open: boolean) => void;

  // Auto-save status
  autoSaveStatus: string;
  setAutoSaveStatus: (status: string) => void;

  // Close all modals (for Escape key)
  closeAllModals: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Theme - default light
      theme: 'light',
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'dark' ? 'light' : 'dark',
      })),
      setTheme: (theme) => set({ theme }),

      // Color Scheme - default
      colorScheme: 'default',
      setColorScheme: (colorScheme) => set({ colorScheme }),

      // Density - default comfortable
      density: 'comfortable',
      setDensity: (density) => set({ density }),

      // Preview - default visible at 50% width
      previewVisible: true,
      previewWidth: 50,
      togglePreview: () => set((state) => ({ previewVisible: !state.previewVisible })),
      setPreviewVisible: (visible) => set({ previewVisible: visible }),
      setPreviewWidth: (width) => set({ previewWidth: Math.max(20, Math.min(80, width)) }),

      // Modals
      profileModalOpen: false,
      restoreModalOpen: false,
      referenceLibraryOpen: false,
      aboutModalOpen: false,
      nistModalOpen: false,
      batchModalOpen: false,
      findReplaceOpen: false,
      templateLoaderOpen: false,
      piiWarningOpen: false,
      documentGuideOpen: false,
      shareModal: null,
      setProfileModalOpen: (open) => set({ profileModalOpen: open }),
      setRestoreModalOpen: (open) => set({ restoreModalOpen: open }),
      setShareModal: (mode) => set({ shareModal: mode }),
      setReferenceLibraryOpen: (open) => set({ referenceLibraryOpen: open }),
      setAboutModalOpen: (open) => set({ aboutModalOpen: open }),
      setNistModalOpen: (open) => set({ nistModalOpen: open }),
      setBatchModalOpen: (open) => set({ batchModalOpen: open }),
      setFindReplaceOpen: (open) => set({ findReplaceOpen: open }),
      setTemplateLoaderOpen: (open) => set({ templateLoaderOpen: open }),
      setPiiWarningOpen: (open) => set({ piiWarningOpen: open }),
      setDocumentGuideOpen: (open) => set({ documentGuideOpen: open }),

      // Mobile
      isMobile: false,
      setIsMobile: (mobile) => set({ isMobile: mobile }),
      mobilePreviewOpen: false,
      setMobilePreviewOpen: (open) => set({ mobilePreviewOpen: open }),

      // Auto-save
      autoSaveStatus: '',
      setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),

      // Close all modals
      closeAllModals: () => set({
        profileModalOpen: false,
        restoreModalOpen: false,
        referenceLibraryOpen: false,
        aboutModalOpen: false,
        nistModalOpen: false,
        batchModalOpen: false,
        findReplaceOpen: false,
        templateLoaderOpen: false,
        documentGuideOpen: false,
        mobilePreviewOpen: false,
        shareModal: null,
        // Note: piiWarningOpen is intentionally not closed by Escape
        // to prevent accidental dismissal of security warnings
      }),
    }),
    {
      name: 'dondocs_ui',
      partialize: (state) => ({
        theme: state.theme,
        colorScheme: state.colorScheme,
        density: state.density,
        previewVisible: state.previewVisible,
        previewWidth: state.previewWidth,
      }),
    }
  )
);
