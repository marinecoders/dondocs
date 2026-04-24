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
  // Terminal error (dismissible)
  | { kind: 'error'; target: 'pdf' | 'docx'; title: string; message: string };

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
