import { useCallback, useEffect, useRef } from 'react';
import { captureCurrentDocumentRevision } from '@/stores/captureDocument';
import { captureDocumentTarget, isCurrentDocumentTarget, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
import { showAppAlert } from '@/stores/alertStore';
import { renderDocumentForPrint, type PrintRenderer } from '@/services/pdf/printDocument';

interface PrintRequest {
  target: DocumentTarget;
  tab: Window;
  status: HTMLElement;
  abort: AbortController;
}

function showPrintPdf(doc: Document, status: HTMLElement, bytes: Uint8Array) {
  const view = doc.defaultView;
  if (!view) throw new Error('The print tab is unavailable.');
  const url = view.URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
  doc.title = 'Print document';
  status.textContent = 'Use the PDF viewer’s print controls if the print dialog does not appear. ';
  const link = doc.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open PDF';
  status.append(link);

  const frame = doc.createElement('iframe');
  frame.title = 'PDF to print';
  frame.style.cssText = 'display:block;width:100%;height:calc(100dvh - 72px);border:0';
  frame.addEventListener('load', () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // Some PDF viewers run outside the frame's origin. The PDF stays
      // openable with the explicit link and the viewer's own print control.
    }
  }, { once: true });
  frame.src = url;
  doc.body.append(frame);
}

/** The shortcut owns a captured revision and a reserved browser tab. The
 * live preview can finish independently and never supplies the printed bytes. */
export function usePrintCurrentDocument({ compile, waitForReady }: PrintRenderer) {
  const active = useRef<PrintRequest | null>(null);
  useEffect(() => {
    const invalidate = () => {
      const request = active.current;
      if (!request || isCurrentDocumentTarget(request.target)) return;
      active.current = null;
      request.abort.abort();
      request.status.textContent = 'The draft changed while the PDF was preparing. Press Print again from the current draft.';
    };
    const unsubscribers = [useDocumentStore.subscribe(invalidate), useFormStore.subscribe(invalidate), useDocumentsStore.subscribe(invalidate)];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      const request = active.current;
      active.current = null;
      request?.abort.abort();
      request?.tab.close();
    };
  }, []);

  return useCallback(() => {
    const previous = active.current;
    if (previous) {
      if (!previous.tab.closed) {
        previous.tab.focus();
        return;
      }
      active.current = null;
      previous.abort.abort();
    }
    const target = captureDocumentTarget();
    if (!target) return;
    let tab: Window | null = null;
    try {
      const captured = captureCurrentDocumentRevision();
      // Reserve a blank tab during the key gesture. It receives no PDF until
      // this revision has rendered successfully.
      tab = window.open('', '_blank');
      if (!tab) throw new Error('Allow pop-ups for DonDocs, then try printing again.');
      tab.opener = null;
      const doc = tab.document;
      doc.documentElement.lang = 'en';
      doc.title = 'Preparing PDF';
      const status = doc.createElement('p');
      status.setAttribute('role', 'status');
      status.style.cssText = 'margin:16px;font:16px system-ui';
      status.textContent = 'Preparing the current document for print…';
      doc.body.replaceChildren(status);
      const request: PrintRequest = { target, tab, status, abort: new AbortController() };
      active.current = request;
      const { abort } = request;
      const close = () => {
        if (active.current === request) active.current = null;
        abort.abort();
      };
      tab.addEventListener('pagehide', close, { once: true, signal: abort.signal });
      const timeout = setTimeout(() => {
        if (active.current !== request) return;
        close();
        status.textContent = 'The PDF took too long to prepare. Check the preview, then try printing again.';
      }, 60_000);
      abort.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
      void renderDocumentForPrint(captured, { compile, waitForReady }, abort.signal).then(bytes => {
        if (active.current !== request || request.tab.closed || request.tab.document !== doc || !status.isConnected) return;
        if (!isCurrentDocumentTarget(target)) {
          status.textContent = 'The draft changed while the PDF was preparing. Press Print again from the current draft.';
          return;
        }
        if (!bytes.byteLength) throw new Error('The PDF engine produced an empty document.');
        showPrintPdf(doc, status, bytes);
      }).catch(error => {
        if (!abort.signal.aborted && !request.tab.closed) {
          const message = error instanceof Error ? error.message : 'Try printing again.';
          status.textContent = `Could not prepare this revision for print. ${message}`;
        }
      }).finally(close);
    } catch (error) {
      tab?.close();
      showAppAlert({ title: 'Could not print this revision', message: error instanceof Error ? error.message : 'Try printing again.' });
    }
  }, [compile, waitForReady]);
}
