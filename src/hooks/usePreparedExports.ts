import type { LatexCompileProfile } from '@/services/latex/renderDocument';
import { exportErrorMessage } from '@/lib/exportDiagnostics';
import { renderPreparedConfiguredForm } from '@/services/exports/configuredForms';
import { captureExportFormTemplates } from '@/services/exports/formTemplates';
import { renderPreparedBuiltinForm } from '@/services/exports/builtinForms';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { createExportController, type ExportGate } from '@/lib/exportController';
import { copyExportReview, type ExportTarget } from '@/lib/preparedExport';
import { captureCurrentDocumentRevision } from '@/stores/captureDocument';
import { copyCapturedSession } from '@/lib/capturedDocument';
import { correspondenceFilename } from '@/stores/documentsStore';
import { getExportDeploymentPolicy } from '@/config/classification';
import { renderPreparedCorrespondence } from '@/services/exports/correspondence';
import { convertLatexToDocx } from '@/services/docx/pandoc-converter';
import { openBrowserExportDelivery } from '@/utils/exportDelivery';
import { useUIStore } from '@/stores/uiStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { docxPhaseToDownloadPhase, type DownloadProgressPhase } from '@/components/modals/downloadProgressTypes';

const ENGINE_STARTING = 'The LaTeX engine is still starting. Retry this export when it is ready.';

interface PreparedExportOptions {
  isReady: boolean;
  gate: ExportGate;
  compile(files: Record<string, string | Uint8Array>, profile?: LatexCompileProfile): Promise<Uint8Array | null>;
  waitForReady(timeoutMs?: number): Promise<boolean>;
  setProgress: Dispatch<SetStateAction<DownloadProgressPhase | null>>;
}

/** React owns presentation. The controller owns the request and approval. */
export function usePreparedExports({ isReady, gate, compile, waitForReady, setProgress }: PreparedExportOptions) {
  const engineReady = useRef(isReady);
  useLayoutEffect(() => { engineReady.current = isReady; }, [isReady]);
  const [owner] = useState(() => {
    let deliveryIntent: { id: string; purpose: 'signing' | 'print' } | null = null;
    let viewActive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const owner = createExportController({
      gate,
      resolvePolicy: retry => getExportDeploymentPolicy(undefined, retry),
      captureResources: captureExportFormTemplates,
      openDelivery: target => {
        const signingId = target === 'pdf' && deliveryIntent?.purpose === 'signing' ? deliveryIntent.id : null;
        if (!signingId) return openBrowserExportDelivery(target, deliveryIntent?.purpose === 'print');
        let released = false;
        return {
          deliver: async artifact => {
            if (released || artifact.job.id !== signingId) throw new Error('This signing capture is no longer available.');
            const { retainSigningExport } = await import('@/services/exports/signingDelivery');
            await retainSigningExport(artifact, () => viewActive && !released && deliveryIntent?.id === signingId);
            return true;
          },
          release: () => { released = true; },
        };
      },
      render: async (ready, signal) => {
        let active = true;
        const progress = (phase: DownloadProgressPhase) => { if (viewActive && active && !signal.aborted) setProgress(phase); };
        try {
          if (ready.job.kind === 'configured-form') return await renderPreparedConfiguredForm(ready, signal);
          if (ready.job.kind === 'builtin-form') {
            const printable = deliveryIntent?.id === ready.job.id
              && deliveryIntent.purpose === 'print';
            return await renderPreparedBuiltinForm(ready, signal, printable ? 'printable' : 'editable');
          }
          if (ready.job.target === 'pdf' && !engineReady.current) throw new Error(ENGINE_STARTING);
          if (ready.job.target === 'pdf' && !await waitForReady(30_000)) throw new Error(ENGINE_STARTING);
          const render = () => renderPreparedCorrespondence(ready, {
            compile, convertDocx: convertLatexToDocx,
            onProgress: kind => progress({ kind }),
            onDocxProgress: phase => progress(docxPhaseToDownloadPhase(phase)),
          }, signal);
          try { return await render(); }
          catch (error) {
            if (signal.aborted || !(error instanceof Error) || error.message !== 'ENGINE_RESET_NEEDED') throw error;
            if (!await waitForReady(30_000)) throw new Error('The LaTeX engine could not recover. Retry this prepared export.', { cause: error });
            return await render();
          }
        } finally { active = false; }
      },
      onState: state => {
        if (!viewActive) return;
        if (timer) { clearTimeout(timer);timer = undefined; }
        useUIStore.getState().setPiiWarningOpen(state.phase === 'review' && state.stage === 'privacy');
        useUIStore.getState().setStructureWarningOpen(state.phase === 'review' && state.stage === 'structure');
        if (state.phase === 'preparing') setProgress({ kind: state.target === 'docx' ? 'docx-preparing' : state.target === 'tex' ? 'tex-preparing' : 'pdf-preparing' });
        else if (state.phase === 'review' || state.phase === 'idle') setProgress(null);
        else if (state.phase === 'error') setProgress({ kind: 'error', target: state.target, title: state.message === ENGINE_STARTING ? 'Engine still starting up' : `${state.target.toUpperCase()} download failed`, message: state.message, compileLog: state.compileLog, retryable: state.retryable, reportable: true });
        else if (state.phase === 'executing') {
          if ((state.execution.status === 'queued' || state.execution.status === 'running') && state.execution.cancellationRequested) setProgress({ kind: 'cancelling' });
          else if (state.execution.status === 'queued') setProgress({ kind: state.job.target === 'docx' ? 'docx-preparing' : state.job.target === 'tex' ? 'tex-preparing' : 'pdf-preparing' });
        } else if (state.phase === 'success') {
          if (state.job.target === 'pdf') useOnboardingStore.getState().markComplete('first_document');
          const success: DownloadProgressPhase = { kind: 'success' };setProgress(success);
          timer = setTimeout(() => { setProgress(current => current === success ? null : current);timer = undefined; }, 1800);
        }
      },
      onCleanupIssue: error => { console.warn('Export delivery cleanup failed:', error); },
    });
    return { controller: owner, getDeliveryIntent: () => deliveryIntent, setDeliveryIntent: (intent: typeof deliveryIntent) => { deliveryIntent = intent; }, activate: () => { viewActive = true; }, deactivate: () => {
      viewActive = false;
      if (timer) { clearTimeout(timer);timer = undefined; }
      useUIStore.getState().setPiiWarningOpen(false);
      useUIStore.getState().setStructureWarningOpen(false);
    } };
  });
  const { controller } = owner;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { owner.activate();return () => { owner.deactivate();controller.cancel(); }; }, [controller, owner]);
  const review = useMemo(() => state.phase === 'review' ? copyExportReview(state.job) : null, [state]);
  const request = useCallback((target: ExportTarget, texMode?: 'configuration' | 'flat', purpose?: 'signing' | 'tagged' | 'word-enclosures' | 'print' | 'word-proofread') => {
    try {
      const captured = captureCurrentDocumentRevision();
      const session = copyCapturedSession(captured);
      const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
      const filename = captured.kind === 'builtin-form'
        ? session.formType === 'navmc_10274'
          ? `NAVMC-10274-${safe(session.forms?.navmc10274?.date || 'form')}.pdf`
          : `NAVMC-118-11-${safe(session.forms?.navmc11811?.lastName || 'Marine')}-${safe(session.forms?.navmc11811?.entryDate || 'entry')}.pdf`
        : captured.kind === 'configured-form' ? `${safe(session.genericForm!.definition.formId)}-form.pdf` : correspondenceFilename(target, session);
      const id = [...crypto.getRandomValues(new Uint32Array(4))].map(part => part.toString(16)).join('-');
      const previous = owner.getDeliveryIntent();
      owner.setDeliveryIntent((purpose === 'signing' || purpose === 'print') && target === 'pdf' ? { id, purpose } : null);
      const accepted = controller.request({
        id, captured, target, texMode,
        ...(purpose === 'word-enclosures' ? { wordEnclosurePages: true } : {}),
        ...(purpose === 'word-proofread' ? { wordProofreadComments: true } : {}),
        ...(purpose === 'tagged' ? { pdfAccessibility: 'tagged' as const } : {}),
        filename: purpose === 'word-enclosures' ? filename.replace(/\.docx$/i, '-with-enclosures.docx')
          : purpose === 'word-proofread' ? filename.replace(/\.docx$/i, '-proofread.docx')
            : target === 'tex' && texMode === 'flat' ? 'correspondence-flat.tex'
              : purpose === 'tagged' ? filename.replace(/\.pdf$/i, '-tagged.pdf') : filename,
      });
      if (!accepted) owner.setDeliveryIntent(previous);
      return accepted;
    } catch (error) {
      setProgress({ kind: 'error', target, title: 'Export could not be captured', message: exportErrorMessage(error), retryable: false });
      return false;
    }
  }, [controller, owner, setProgress]);
  const confirm = () => state.phase === 'review' && controller.confirm(state.job, state.stage);
  const cancelReview = () => state.phase === 'review' && controller.cancelReview(state.job, state.stage);
  const canCancel = state.phase === 'preparing' || state.phase === 'executing'
    && (state.execution.status === 'queued' || state.execution.status === 'running' && state.execution.phase === 'rendering')
    && !state.execution.cancellationRequested;
  return { state, review, request, confirm, cancelReview, retry: controller.retry, cancel: controller.cancel, canCancel };
}
