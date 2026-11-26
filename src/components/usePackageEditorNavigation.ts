import { useRef, useState, type KeyboardEvent } from 'react';

/** Keep the current editor available until the save and destination change have settled. */
export function usePackageEditorNavigation(flush: () => Promise<boolean>) {
  const switching = useRef(false);
  const [navigating, setNavigating] = useState(false);
  const [navigationError, setNavigationError] = useState('');

  async function navigate(open: () => void | Promise<void>) {
    if (switching.current) return;
    switching.current = true;
    setNavigating(true);
    setNavigationError('');
    try {
      if (await flush()) await open();
    } catch (error) {
      setNavigationError(error instanceof Error && error.message ? error.message : 'The package destination could not be opened. Try again.');
    } finally {
      switching.current = false;
      setNavigating(false);
    }
  }

  return { navigate, navigating, navigationError };
}

export function handlePackageSaveShortcut(event: KeyboardEvent, save: () => void) {
  if (event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) save();
}
