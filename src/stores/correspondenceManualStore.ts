import { create } from 'zustand';
import { useUIStore } from './uiStore';
import type { ManualLocation } from '@/lib/correspondenceManual';

interface ReferenceDock { sourceId: string; page: number; showPdf: boolean }
export const useCorrespondenceManualStore = create<{ location: ManualLocation; request: number; dock: ReferenceDock | null }>(() => ({ location: {}, request: 0, dock: null }));

export function openCorrespondenceManual(location: ManualLocation = {}): void {
  useCorrespondenceManualStore.setState(state => ({ location: { ...location }, request: state.request + 1 }));
  useUIStore.getState().setDocumentGuideTab('manual');
  useUIStore.getState().setDocumentGuideOpen(true);
}

export function openReferenceBesideDraft(dock: ReferenceDock): void {
  useCorrespondenceManualStore.setState({ dock });
  useUIStore.getState().setDocumentGuideOpen(false);
}

export function toggleWorkspacePreview(): void {
  const ui = useUIStore.getState();
  if (!ui.isMobile && useCorrespondenceManualStore.getState().dock) {
    useCorrespondenceManualStore.setState({ dock: null });
    ui.setPreviewVisible(true);
  } else ui.togglePreview();
}
