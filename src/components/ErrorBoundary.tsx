import { Component, type ErrorInfo, type ReactNode } from 'react';
import { debug } from '@/lib/debug';
import { STORAGE_KEYS } from '@/lib/constants';

interface ErrorBoundaryProps {
  children: ReactNode;
}

// Distinct states so the user can tell apart "your draft is in your
// clipboard" from "there was nothing to copy" from "we tried but the
// browser refused (e.g. clipboard permission denied or insecure
// context — clipboard API needs HTTPS or localhost)".
type CopyStatus = 'idle' | 'copied' | 'empty' | 'failed';

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  detailsOpen: boolean;
  copyStatus: CopyStatus;
}

/**
 * Top-level error boundary for the app.
 *
 * Catches any render-phase exception in the tree below it and shows a
 * recovery UI instead of leaving the user with a white screen. The
 * recovery UI is intentionally low-dependency: inline styles + a couple
 * of Tailwind utility classes only. Anything richer (shadcn Button,
 * Dialog, theme tokens) risks being part of *what crashed*.
 *
 * The boundary itself can't recover from errors in event handlers, async
 * code, server-rendered HTML, or errors thrown in the boundary itself.
 * For our purposes that's fine — the dominant failure mode this addresses
 * is a render-time bug somewhere in the editor / form / preview tree
 * that turned the whole tab into a white screen with no way out.
 *
 * Recovery options offered to the user:
 *  - Copy session: exfiltrate the auto-saved JSON to the clipboard so
 *    they can paste it into a recovery channel (or just hold it before
 *    a wipe).
 *  - Reload: window.location.reload(). Cheap. Often enough — the boundary
 *    only catches RENDER errors, so reloading replays the same render
 *    against the same persisted state and will likely crash again, but
 *    sometimes the crash was a transient network or async race.
 *  - Reset & reload: clear localStorage[STORAGE_KEY] then reload. The
 *    escape hatch when the persisted session itself is what's crashing
 *    on rehydrate.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
    detailsOpen: false,
    copyStatus: 'idle',
  };
  // Tracks the pending copy-status reset timer so we can clear it on
  // unmount (or on a second click that supersedes the first). Without
  // this we'd risk a setState-on-unmounted-component warning if the user
  // clicks Reload within the 2s window.
  private copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Funnel into the existing debug stream so the in-app log viewer (and
    // anything wired up to it later, e.g. a remote sink) captures the crash.
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
      const data = localStorage.getItem(STORAGE_KEYS.DOCUMENT);
      if (!data) {
        this.setState({ copyStatus: 'empty' });
        this.scheduleCopyStatusReset();
        return;
      }
      // navigator.clipboard requires a secure context (HTTPS or
      // localhost). On http://192.168.x.x and similar, writeText
      // rejects — we fall through to the catch below and surface a
      // distinct "failed" status so the user knows it wasn't an
      // empty-draft case.
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

  handleResetAndReload = (): void => {
    if (!window.confirm('This will erase your auto-saved draft and reload. Continue?')) {
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEYS.DOCUMENT);
    } catch (err) {
      debug.error('Boundary', 'Failed to clear session before reload', err);
    }
    window.location.reload();
  };

  toggleDetails = (): void => {
    this.setState((s) => ({ detailsOpen: !s.detailsOpen }));
  };

  render(): ReactNode {
    const { error, errorInfo, detailsOpen, copyStatus } = this.state;

    if (!error) {
      return this.props.children;
    }

    // Inline styles only — Tailwind classes might fail to load if a CSS
    // regression is what crashed the app. The container styling here is
    // deliberately boring so it works even on a blank document.
    const containerStyle: React.CSSProperties = {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      backgroundColor: '#f8fafc',
      color: '#0f172a',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    };

    const cardStyle: React.CSSProperties = {
      maxWidth: '640px',
      width: '100%',
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '8px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)',
    };

    const buttonStyle: React.CSSProperties = {
      padding: '8px 14px',
      borderRadius: '6px',
      border: '1px solid #cbd5e1',
      backgroundColor: '#ffffff',
      color: '#0f172a',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
    };

    const primaryButtonStyle: React.CSSProperties = {
      ...buttonStyle,
      backgroundColor: '#0f172a',
      color: '#ffffff',
      borderColor: '#0f172a',
    };

    const dangerButtonStyle: React.CSSProperties = {
      ...buttonStyle,
      borderColor: '#dc2626',
      color: '#dc2626',
    };

    const codeStyle: React.CSSProperties = {
      display: 'block',
      backgroundColor: '#f1f5f9',
      border: '1px solid #e2e8f0',
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
          <p style={{ margin: '0 0 16px 0', color: '#475569', fontSize: '14px', lineHeight: 1.5 }}>
            DonDocs hit an error it couldn't recover from. Your auto-saved draft is
            still in this browser — you can copy it to your clipboard before reloading.
          </p>

          <div
            style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '13px',
              color: '#991b1b',
              wordBreak: 'break-word',
            }}
          >
            {/*
              React generally wraps non-Error throws with `Error`, but
              user code can still throw a plain string, null, or a
              POJO. Coerce defensively so the boundary never throws
              while rendering its own fallback (which would be
              catastrophic — the boundary can't catch its own errors).
            */}
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

          <button
            type="button"
            onClick={this.toggleDetails}
            style={{
              ...buttonStyle,
              border: 'none',
              padding: '4px 0',
              backgroundColor: 'transparent',
              color: '#475569',
              fontSize: '13px',
            }}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? '▾ Hide details' : '▸ Show details'}
          </button>

          {detailsOpen && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                Stack trace
              </div>
              <code style={codeStyle}>{String(error.stack ?? '(no stack available)')}</code>
              {errorInfo?.componentStack && (
                <>
                  <div style={{ fontSize: '12px', color: '#475569', margin: '12px 0 4px 0' }}>
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
