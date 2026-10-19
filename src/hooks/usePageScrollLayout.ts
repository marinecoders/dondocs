import { useSyncExternalStore } from 'react';
import { useUIStore } from '@/stores/uiStore';

const QUERY = '(max-height: 500px)';
function subscribe(callback: () => void) {
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
const getSnapshot = () => window.matchMedia(QUERY).matches;

/** Short compact windows scroll the workspace, leaving room to edit. */
export function usePageScrollLayout(): boolean {
  const compact = useUIStore(s => s.isMobile);
  const short = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return compact && short;
}
