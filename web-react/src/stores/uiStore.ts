import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;

  // Preview panel
  previewVisible: boolean;
  togglePreview: () => void;
  setPreviewVisible: (visible: boolean) => void;

  // Modals
  profileModalOpen: boolean;
  restoreModalOpen: boolean;
  referenceLibraryOpen: boolean;
  aboutModalOpen: boolean;
  nistModalOpen: boolean;
  batchModalOpen: boolean;
  setProfileModalOpen: (open: boolean) => void;
  setRestoreModalOpen: (open: boolean) => void;
  setReferenceLibraryOpen: (open: boolean) => void;
  setAboutModalOpen: (open: boolean) => void;
  setNistModalOpen: (open: boolean) => void;
  setBatchModalOpen: (open: boolean) => void;

  // Mobile
  isMobile: boolean;
  setIsMobile: (mobile: boolean) => void;
  mobilePreviewOpen: boolean;
  setMobilePreviewOpen: (open: boolean) => void;

  // Auto-save status
  autoSaveStatus: string;
  setAutoSaveStatus: (status: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Theme - default dark
      theme: 'dark',
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'dark' ? 'light' : 'dark',
      })),
      setTheme: (theme) => set({ theme }),

      // Preview - hidden by default
      previewVisible: false,
      togglePreview: () => set((state) => ({ previewVisible: !state.previewVisible })),
      setPreviewVisible: (visible) => set({ previewVisible: visible }),

      // Modals
      profileModalOpen: false,
      restoreModalOpen: false,
      referenceLibraryOpen: false,
      aboutModalOpen: false,
      nistModalOpen: false,
      batchModalOpen: false,
      setProfileModalOpen: (open) => set({ profileModalOpen: open }),
      setRestoreModalOpen: (open) => set({ restoreModalOpen: open }),
      setReferenceLibraryOpen: (open) => set({ referenceLibraryOpen: open }),
      setAboutModalOpen: (open) => set({ aboutModalOpen: open }),
      setNistModalOpen: (open) => set({ nistModalOpen: open }),
      setBatchModalOpen: (open) => set({ batchModalOpen: open }),

      // Mobile
      isMobile: false,
      setIsMobile: (mobile) => set({ isMobile: mobile }),
      mobilePreviewOpen: false,
      setMobilePreviewOpen: (open) => set({ mobilePreviewOpen: open }),

      // Auto-save
      autoSaveStatus: '',
      setAutoSaveStatus: (status) => set({ autoSaveStatus: status }),
    }),
    {
      name: 'libo_ui',
      partialize: (state) => ({
        theme: state.theme,
        previewVisible: state.previewVisible,
      }),
    }
  )
);
