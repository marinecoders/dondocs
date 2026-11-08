import { Download } from 'lucide-react';
import { IconTip } from '@/components/ui/icon-tip';

interface UpdateAvailableButtonProps {
  onClick: () => void;
}

export function UpdateAvailableButton({ onClick }: UpdateAvailableButtonProps) {
  return (
    <IconTip label="Update Available" side="right">
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        className="inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-md text-info outline-none transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Download className="size-4" aria-hidden="true" />
      </button>
    </IconTip>
  );
}
