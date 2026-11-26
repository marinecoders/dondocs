import type { PackageReviewBinding } from './actionPackages';

type ReadingBinding = Pick<PackageReviewBinding, 'packageId' | 'memberId' | 'memberDigest'>;
type ReadingState = 'unread' | 'changed' | 'moved' | 'read';

function storageKey(binding: ReadingBinding): string {
  return 'dondocs-package-reading/v1/' + encodeURIComponent(binding.packageId) + '/' + encodeURIComponent(binding.memberId);
}

/** Local reading history contains only an exact digest and filing position. */
export function packageReadingState(binding: ReadingBinding, position: number): ReadingState {
  try {
    const raw = localStorage.getItem(storageKey(binding));
    if (!raw) return 'unread';
    const mark: unknown = JSON.parse(raw);
    if (!Array.isArray(mark) || mark.length !== 2 || typeof mark[0] !== 'string' ||
        !/^[a-f0-9]{64}$/.test(mark[0]) || !Number.isSafeInteger(mark[1]) || mark[1] < 0) return 'unread';
    if (mark[0] !== binding.memberDigest) return 'changed';
    return mark[1] === position ? 'read' : 'moved';
  } catch {
    return 'unread';
  }
}

const localChange = 'dondocs-package-reading-changed';

export function subscribePackageReading(refresh: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith('dondocs-package-reading/v1/')) refresh();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(localChange, refresh);
  return () => {
    window.removeEventListener(localChange, refresh);
    window.removeEventListener('storage', onStorage);
  };
}

export function markPackageReading(binding: ReadingBinding, position: number, read: boolean): boolean {
  try {
    if (read) localStorage.setItem(storageKey(binding), JSON.stringify([binding.memberDigest, position]));
    else localStorage.removeItem(storageKey(binding));
    window.dispatchEvent(new Event(localChange));
    return true;
  } catch {
    return false;
  }
}
