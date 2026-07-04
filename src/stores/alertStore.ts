import { create } from 'zustand';

/**
 * In-app replacement for native `alert()` / `confirm()`.
 *
 * Native dialogs follow the OS theme, not the app's — a white popup over a
 * dark UI (the same class of bug as the old crash screen). Every message the
 * app raises goes through this store instead and renders in the themed
 * <AppAlertDialog/> mounted once in App. ESLint's `no-alert` rule keeps new
 * native calls out.
 *
 * Imperative helpers (`showAppAlert`, `showAppConfirm`) work from anywhere —
 * React components and plain utils alike (e.g. downloadPdf.ts) — because
 * zustand stores are framework-free.
 *
 * Session-only by design: dialogs are transient UI, nothing persists.
 */

interface AlertRequest {
  title: string;
  /** Rendered with `whitespace-pre-line`, so \n line breaks survive. */
  message: string;
  /** Present only for confirms; resolves that showAppConfirm() promise. */
  confirm?: {
    confirmLabel: string;
    destructive: boolean;
    resolve: (confirmed: boolean) => void;
  };
}

interface AlertState {
  /** Controls the Radix open prop. `current` intentionally survives dismiss
   *  so the exit animation doesn't render an empty dialog. */
  open: boolean;
  current: AlertRequest | null;
  /** Native alert() queues when fired back-to-back; so do we. */
  queue: AlertRequest[];
  show: (req: AlertRequest) => void;
  /** Called by the dialog on OK / Cancel / Esc. `confirmed` is false for
   *  every path except the explicit confirm button. */
  dismiss: (confirmed: boolean) => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  open: false,
  current: null,
  queue: [],
  show: (req) => {
    const { open, queue } = get();
    if (open) {
      set({ queue: [...queue, req] });
    } else {
      set({ open: true, current: req });
    }
  },
  dismiss: (confirmed) => {
    const { current, queue } = get();
    current?.confirm?.resolve(confirmed);
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      set({ current: next, queue: rest });
    } else {
      set({ open: false });
    }
  },
}));

/** Themed drop-in for `alert(message)`. Returns immediately (fire-and-forget,
 *  like the sites it replaced — none of them awaited the dismissal). */
export function showAppAlert(opts: { title: string; message: string }): void {
  useAlertStore.getState().show(opts);
}

/** Themed drop-in for `confirm(message)` — resolves true only when the user
 *  presses the confirm button; Cancel/Esc resolve false. */
export function showAppConfirm(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useAlertStore.getState().show({
      title: opts.title,
      message: opts.message,
      confirm: {
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        destructive: opts.destructive ?? false,
        resolve,
      },
    });
  });
}
