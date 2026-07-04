import { Component, type ErrorInfo, type ReactNode } from 'react';
import { debug } from '@/lib/debug';
import { STORAGE_KEYS } from '@/lib/constants';
import { getSavedSession } from '@/stores/documentStore';
import { idbGetCurrentId, idbDeleteDocument, idbDeleteSnapshots, idbSetCurrentId } from '@/lib/documentsDb';

interface ErrorBoundaryProps {
  children: ReactNode;
}

// Distinct states: copied, nothing to copy, or the browser refused (clipboard
// needs a secure context).
type CopyStatus = 'idle' | 'copied' | 'empty' | 'failed';

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  detailsOpen: boolean;
  copyStatus: CopyStatus;
  /** "Reset and reload" asks for confirmation inline (no native confirm(), which
   *  follows the OS theme, not the app's, and reads as a foreign white popup). */
  confirmingReset: boolean;
}

/** The app's dark class on <html> is the single source of truth for the active
 *  scheme — index.html sets it pre-paint from the saved theme, falling back to
 *  the OS preference — so the crash screen can honor it without touching any of
 *  the (possibly crashed) CSS. */
function isDarkMode(): boolean {
  try {
    return document.documentElement.classList.contains('dark');
  } catch {
    return false;
  }
}

/**
 * Top-level error boundary. Catches render-phase exceptions below it and shows a
 * recovery UI instead of a white screen. The recovery UI uses inline styles only,
 * since richer components could be part of what crashed — but the palette is
 * chosen per the active light/dark scheme so the crash screen doesn't blast a
 * white page at a dark-mode user.
 *
 * Recovery options:
 *  - Copy session: copy the auto-saved JSON to the clipboard before a wipe.
 *  - Reload: replays the same render against the same state (helps only a
 *    transient crash) but is cheap.
 *  - Reset & reload: clear the persisted session, for when it's what crashes on
 *    rehydrate. Confirmed inline, not via window.confirm.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
    detailsOpen: false,
    copyStatus: 'idle',
    confirmingReset: false,
  };
  // Pending copy-status reset timer, cleared on unmount or a superseding click to
  // avoid a setState-on-unmounted warning.
  private copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Funnel into the debug stream so the in-app log viewer captures the crash.
    debug.error('Boundary', 'Render error caught', { error, errorInfo });
  }

  componentWillUnmount(): void {
    if (this.copyStatusTimer !== null) {
      clearTimeout(this.copyStatusTimer);
      this.copyStatusTimer = null;
    }
  }

  private scheduleCopyStatusReset(): void {
    if (this.copyStatusTimer !== null) {
      clearTimeout(this.copyStatusTimer);
    }
    this.copyStatusTimer = setTimeout(() => {
      this.copyStatusTimer = null;
      this.setState({ copyStatus: 'idle' });
    }, 2000);
  }

  handleCopySession = async (): Promise<void> => {
    try {
      // The auto-saved session is stored compressed under DOCUMENT_SESSION;
      // decompress it to readable JSON, falling back to the manual draft.
      const session = getSavedSession();
      const data = session
        ? JSON.stringify(session, null, 2)
        : localStorage.getItem(STORAGE_KEYS.DOCUMENT);
      if (!data) {
        this.setState({ copyStatus: 'empty' });
        this.scheduleCopyStatusReset();
        return;
      }
      // navigator.clipboard needs a secure context; over plain http it rejects
      // and falls to the catch, which surfaces a distinct "failed" status.
      await navigator.clipboard.writeText(data);
      this.setState({ copyStatus: 'copied' });
      this.scheduleCopyStatusReset();
    } catch (err) {
      debug.error('Boundary', 'Failed to copy session', err);
      this.setState({ copyStatus: 'failed' });
      this.scheduleCopyStatusReset();
    }
  };

  handleReload = (): void => {
    window.location.reload();
  };

  /** First click arms the inline confirmation strip; the strip's button calls
   *  performResetAndReload. No window.confirm — a native dialog follows the OS
   *  theme rather than the app's and can't be styled. */
  handleResetAndReload = (): void => {
    this.setState({ confirmingReset: true });
  };

  handleCancelReset = (): void => {
    this.setState({ confirmingReset: false });
  };

  performResetAndReload = async (): Promise<void> => {
    try {
      // init() resumes from the IndexedDB registry before reading these
      // localStorage keys, so clearing localStorage alone left the crashing doc to
      // reload in a loop. Drop the current IndexedDB record and its pointer too so
      // init() falls through to a blank document; keep clearing localStorage for
      // the legacy paths.
      localStorage.removeItem(STORAGE_KEYS.DOCUMENT_SESSION);
      localStorage.removeItem(STORAGE_KEYS.DOCUMENT);
      const currentId = await idbGetCurrentId();
      if (currentId) {
        await idbDeleteDocument(currentId);
        // Its version-history snapshots go with it — otherwise up to 10 full
        // copies of the erased document linger in IndexedDB with no UI that
        // can ever list or remove them.
        await idbDeleteSnapshots(currentId);
      }
      await idbSetCurrentId(null);
    } catch (err) {
      debug.error('Boundary', 'Failed to clear session before reload', err);
    }
    window.location.reload();
  };

  toggleDetails = (): void => {
    this.setState((s) => ({ detailsOpen: !s.detailsOpen }));
  };

  render(): ReactNode {
    const { error, errorInfo, detailsOpen, copyStatus, confirmingReset } = this.state;

    if (!error) {
      return this.props.children;
    }

    // Inline styles only, in case a CSS regression is what crashed the app —
    // but honor the active light/dark scheme (read off <html>, not off the
    // possibly-broken stylesheet) so the crash screen matches the app.
    const dark = isDarkMode();
    const c = dark
      ? {
          pageBg: '#0b1120',
          pageFg: '#e2e8f0',
          cardBg: '#111827',
          cardBorder: '#2b3648',
          muted: '#94a3b8',
          btnBg: '#1e293b',
          btnBorder: '#475569',
          btnFg: '#e2e8f0',
          primaryBg: '#e2e8f0',
          primaryFg: '#0f172a',
          danger: '#f87171',
          errBg: '#2a1215',
          errBorder: '#7f1d1d',
          errFg: '#fca5a5',
          codeBg: '#0b1120',
          codeBorder: '#334155',
          shadow: '0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.5)',
        }
      : {
          pageBg: '#f8fafc',
          pageFg: '#0f172a',
          cardBg: '#ffffff',
          cardBorder: '#e2e8f0',
          muted: '#475569',
          btnBg: '#ffffff',
          btnBorder: '#cbd5e1',
          btnFg: '#0f172a',
          primaryBg: '#0f172a',
          primaryFg: '#ffffff',
          danger: '#dc2626',
          errBg: '#fef2f2',
          errBorder: '#fecaca',
          errFg: '#991b1b',
          codeBg: '#f1f5f9',
          codeBorder: '#e2e8f0',
          shadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)',
        };

    const containerStyle: React.CSSProperties = {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      backgroundColor: c.pageBg,
      color: c.pageFg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    };

    const cardStyle: React.CSSProperties = {
      maxWidth: '640px',
      width: '100%',
      backgroundColor: c.cardBg,
      border: `1px solid ${c.cardBorder}`,
      borderRadius: '8px',
      padding: '24px',
      boxShadow: c.shadow,
    };

    const buttonStyle: React.CSSProperties = {
      padding: '8px 14px',
      borderRadius: '6px',
      border: `1px solid ${c.btnBorder}`,
      backgroundColor: c.btnBg,
      color: c.btnFg,
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
    };

    const primaryButtonStyle: React.CSSProperties = {
      ...buttonStyle,
      backgroundColor: c.primaryBg,
      color: c.primaryFg,
      borderColor: c.primaryBg,
    };

    const dangerButtonStyle: React.CSSProperties = {
      ...buttonStyle,
      borderColor: c.danger,
      color: c.danger,
    };

    const codeStyle: React.CSSProperties = {
      display: 'block',
      backgroundColor: c.codeBg,
      border: `1px solid ${c.codeBorder}`,
      borderRadius: '4px',
      padding: '12px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '12px',
      lineHeight: '1.5',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '240px',
    };

    return (
      <div style={containerStyle} role="alert" aria-live="assertive">
        <div style={cardStyle}>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px 0' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 16px 0', color: c.muted, fontSize: '14px', lineHeight: 1.5 }}>
            DonDocs hit an error it couldn't recover from. Your auto-saved draft is
            still in this browser — you can copy it to your clipboard before reloading.
          </p>

          <div
            style={{
              backgroundColor: c.errBg,
              border: `1px solid ${c.errBorder}`,
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '13px',
              color: c.errFg,
              wordBreak: 'break-word',
            }}
          >
            {/* Code can throw a non-Error (string, null, POJO), so coerce: the
                boundary can't catch errors thrown while rendering its own
                fallback. */}
            <strong>{String(error.name ?? 'Error')}:</strong>{' '}
            {String(error.message ?? error)}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={this.handleCopySession}
              style={buttonStyle}
              aria-label="Copy auto-saved session data to clipboard"
            >
              {copyStatus === 'copied'
                ? 'Copied ✓'
                : copyStatus === 'empty'
                  ? 'No saved draft'
                  : copyStatus === 'failed'
                    ? 'Copy failed'
                    : 'Copy saved draft'}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={primaryButtonStyle}
              aria-label="Reload the page"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              style={dangerButtonStyle}
              aria-label="Erase saved draft and reload"
            >
              Reset and reload
            </button>
          </div>

          {confirmingReset && (
            <div
              style={{
                border: `1px solid ${c.danger}`,
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ flex: '1 1 220px' }}>
                This erases your auto-saved draft and reloads. Copy it first if you
                want to keep it.
              </span>
              <button
                type="button"
                onClick={this.performResetAndReload}
                style={{ ...buttonStyle, backgroundColor: c.danger, borderColor: c.danger, color: dark ? '#0f172a' : '#ffffff' }}
              >
                Erase and reload
              </button>
              <button type="button" onClick={this.handleCancelReset} style={buttonStyle}>
                Cancel
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={this.toggleDetails}
            style={{
              ...buttonStyle,
              border: 'none',
              padding: '4px 0',
              backgroundColor: 'transparent',
              color: c.muted,
              fontSize: '13px',
            }}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? '▾ Hide details' : '▸ Show details'}
          </button>

          {detailsOpen && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: c.muted, marginBottom: '4px' }}>
                Stack trace
              </div>
              <code style={codeStyle}>{String(error.stack ?? '(no stack available)')}</code>
              {errorInfo?.componentStack && (
                <>
                  <div style={{ fontSize: '12px', color: c.muted, margin: '12px 0 4px 0' }}>
                    Component stack
                  </div>
                  <code style={codeStyle}>{String(errorInfo.componentStack)}</code>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
}
