/**
 * Shared types + adapter for the DownloadProgressModal.
 *
 * Kept in a separate module from the modal component so the component file
 * can satisfy `react-refresh/only-export-components` (HMR only works when
 * component files export components — sibling function exports break it).
 */

import type { DocxProgressPhase } from '@/services/docx/pandoc-converter';

/**
 * Discriminated union covering every progress state the modal can show.
 *
 * DOCX phases (`docx-*`) mirror `DocxProgressPhase` from the pandoc
 * converter. PDF phases (`pdf-*`) are emitted inline from the PDF
 * download flow in App.tsx. The `error` kind is terminal and makes
 * the modal dismissible so the user can close it and retry.
 */
export type DownloadProgressPhase =
  // DOCX phases (mapped 1:1 from DocxProgressPhase)
  | { kind: 'docx-preparing' }
  | { kind: 'docx-fetching-engine'; loaded: number; total: number }
  | { kind: 'docx-instantiating' }
  | { kind: 'docx-fetching-support' }
  | { kind: 'docx-converting' }
  | { kind: 'docx-postprocessing' }
  // PDF phases
  | { kind: 'pdf-preparing' }
  | { kind: 'pdf-compiling' }
  | { kind: 'pdf-merging-enclosures' }
  | { kind: 'pdf-signing' }
  | { kind: 'pdf-saving' }
  // Terminal error (dismissible).
  // Optional fields drive which action buttons the modal renders — the
  // error-handling code in App.tsx classifies each failure and flips on
  // the fields that make sense for that failure mode.
  | {
      kind: 'error';
      target: 'pdf' | 'docx';
      title: string;
      message: string;
      /**
       * Full compile/engine log to show inline in the modal. When present,
       * the modal renders a scrollable log block and a "Copy logs" button.
       */
      compileLog?: string;
      /**
       * When true, the modal renders a Retry button that invokes
       * `DownloadProgressModalProps.onRetry`. Use for transient failures
       * like "engine not ready" or engine-reset retry exhaustion — cases
       * where the user pressing a button again has a good chance of
       * succeeding.
       */
      retryable?: boolean;
      /**
       * When true, the modal renders a "Report issue on GitHub" button
       * that opens a prefilled issue with the error + log. Use for
       * unexpected failures where we want the user to flag it to us.
       * Skip for known user-facing conditions (engine-not-ready).
       */
      reportable?: boolean;
    };

/**
 * Adapter: convert a DocxProgressPhase (emitted by the converter) to
 * the corresponding DownloadProgressPhase variant. Kept here so that
 * the modal owns the surface-area type and the converter stays
 * DOCX-specific.
 */
export function docxPhaseToDownloadPhase(phase: DocxProgressPhase): DownloadProgressPhase {
  switch (phase.kind) {
    case 'preparing':
      return { kind: 'docx-preparing' };
    case 'fetching-engine':
      return { kind: 'docx-fetching-engine', loaded: phase.loaded, total: phase.total };
    case 'instantiating':
      return { kind: 'docx-instantiating' };
    case 'fetching-support':
      return { kind: 'docx-fetching-support' };
    case 'converting':
      return { kind: 'docx-converting' };
    case 'postprocessing':
      return { kind: 'docx-postprocessing' };
  }
}
