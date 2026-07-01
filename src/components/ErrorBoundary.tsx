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
}

/**
 * Top-level error boundary. Catches render-phase exceptions below it and shows a
 * recovery UI instead of a white screen. The recovery UI uses inline styles only,
 * since richer components could be part of what crashed.
 *
 * Recovery options:
 *  - Copy session: copy the auto-saved JSON to the clipboard before a wipe.
 *  - Reload: replays the same render against the same state (helps only a
 *    transient crash) but is cheap.
 *  - Reset & reload: clear the persisted session, for when it's what crashes on
 *    rehydrate.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
    detailsOpen: false,
    copyStatus: 'idle',
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

  handleResetAndReload = async (): Promise<void> => {
    if (!window.confirm('This will erase your auto-saved draft and reload. Continue?')) {
      return;
    }
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
    const { error, errorInfo, detailsOpen, copyStatus } = this.state;

    if (!error) {
      return this.props.children;
    }

    // Inline styles only, in case a CSS regression is what crashed the app.
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
