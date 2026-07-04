import { useAlertStore } from '@/stores/alertStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * The single renderer for showAppAlert()/showAppConfirm() (alertStore).
 * Mounted once in App; every message the app used to raise via native
 * alert()/confirm() surfaces here in the app's own theme.
 *
 * z-[110]: BrowserCompatibilityNotice's overlay sits at z-[100] and fires
 * alerts of its own ("Open in Safari" instructions) — this dialog must render
 * above it, not underneath. The Radix focus trap works regardless of paint
 * order, so only the content needs the boost; the scrim staying at z-50 is
 * invisible behind the notice's own backdrop and correct everywhere else.
 */
export function AppAlertDialog() {
  const open = useAlertStore((s) => s.open);
  const current = useAlertStore((s) => s.current);
  const dismiss = useAlertStore((s) => s.dismiss);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss(false); // Esc — same as Cancel
      }}
    >
      {current && (
        <AlertDialogContent className="z-[110]">
          <AlertDialogHeader>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            {/* pre-line: the migrated messages carry \n step lists */}
            <AlertDialogDescription className="whitespace-pre-line">
              {current.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* preventDefault on every button: Radix's Action/Cancel otherwise
              fire their own close request AFTER our onClick, dismissing twice
              and eating any queued alert. The store alone drives `open`. */}
          <AlertDialogFooter>
            {current.confirm ? (
              <>
                <AlertDialogCancel
                  onClick={(e) => {
                    e.preventDefault();
                    dismiss(false);
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    dismiss(true);
                  }}
                  className={
                    current.confirm.destructive
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : undefined
                  }
                >
                  {current.confirm.confirmLabel}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  dismiss(false);
                }}
              >
                OK
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
