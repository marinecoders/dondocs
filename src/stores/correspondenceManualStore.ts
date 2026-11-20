import { create } from 'zustand';
import { useUIStore } from './uiStore';
import type { ManualLocation } from '@/lib/correspondenceManual';

export const useCorrespondenceManualStore = create<{ location: ManualLocation; request: number }>(() => ({ location: {}, request: 0 }));

export function openCorrespondenceManual(location: ManualLocation = {}): void {
  useCorrespondenceManualStore.setState(state => ({ location: { ...location }, request: state.request + 1 }));
  useUIStore.getState().setDocumentGuideTab('manual');
  useUIStore.getState().setDocumentGuideOpen(true);
}
