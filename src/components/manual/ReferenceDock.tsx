import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCorrespondenceManualStore } from '@/stores/correspondenceManualStore';
import CorrespondenceManualReader from './CorrespondenceManualReader';
import { ManualViewBoundary } from './ManualViewBoundary';

export default function ReferenceDock() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const viewport = window.matchMedia('(min-width: 64rem)');
    const dismissWhenNarrow = (event: MediaQueryListEvent) => {
      if (!event.matches) useCorrespondenceManualStore.setState({ dock: null });
    };
    viewport.addEventListener('change', dismissWhenNarrow);
    return () => viewport.removeEventListener('change', dismissWhenNarrow);
  }, []);
  return <aside aria-label="Reference beside draft" className="hidden min-w-0 w-[43%] max-w-[48rem] shrink-0 flex-col border-l bg-background lg:flex">
    <header className="flex items-center justify-between gap-2 p-4">
      <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">Reference</h2>
      <Button size="icon-sm" variant="ghost" aria-label="Close reference" onClick={() =>
        useCorrespondenceManualStore.setState({ dock: null })
      }><X aria-hidden="true" /></Button>
    </header>
    <ManualViewBoundary fallback={<p role="alert" className="px-4 text-sm">Could not open the reference. Close it and try again.</p>}>
      <CorrespondenceManualReader besideDraft />
    </ManualViewBoundary>
  </aside>;
}
