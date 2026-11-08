import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useBatchStore } from '@/stores/batchStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { collectAttachmentIds, isRestoreInProgress, isBackupExportInProgress } from '@/lib/backup';
import { isDraftExportInProgress } from '@/lib/draftFile';
import { isBackupWriteInProgress } from '@/stores/backupStore';
import { flushAttachmentWrites, loadAttachment } from '@/lib/attachments';
import { waitForStorage } from '@/lib/documentWrites';
import { isFileImportInProgress } from '@/lib/fileImports';
import { loadPackagePage } from '@/services/forms/packages';
import { readUpdateRestore, writeUpdateRestore, clearUpdateRestore, FAILED_RELEASE_KEY, type UpdateRestorePoint } from './updateRestore';

let guard = () => {};
const editorScroller = () => document.querySelector<HTMLElement>('.workspace-shell[data-page-scroll]')
  ?? document.querySelector<HTMLElement>('.workspace-editor-scroll [data-slot="scroll-area-viewport"]');
export function registerUpdateGuard(next: () => void): () => void {
  guard = next;
  return () => { if (guard === next) guard = () => {}; };
}
function assertIdle() {
  guard();
  if (useBatchStore.getState().status === 'running' || isFileImportInProgress() || isRestoreInProgress() || isBackupExportInProgress() || isDraftExportInProgress() || isBackupWriteInProgress()) throw new Error('Finish the current batch, import, export, or backup before updating.');
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) throw new Error('Finish the open workspace action before updating.');
}
async function saveAndVerify() {
  await waitForStorage(flushAttachmentWrites());
  const drafts = useDocumentsStore.getState();
  if (drafts.currentId && !drafts.docs[drafts.currentId]) drafts.saveCurrent();
  await flushDocumentWrites();
  const registry = useDocumentsStore.getState(), entry = registry.currentId ? registry.docs[registry.currentId] : undefined;
  for (const id of collectAttachmentIds(entry ? [entry] : [])) {
    const bytes = await waitForStorage(loadAttachment(id));
    if (!(bytes instanceof ArrayBuffer)) throw new Error('An attachment is missing from browser storage. Keep this tab open and reattach it before updating.');
  }
  const form = useDocumentStore.getState().genericForm;
  if (form) for (const page of form.definition.pages) await waitForStorage(loadPackagePage(form.definition, page.file, true));
  await flushDocumentWrites();
}
export async function prepareUpdateCheckpoint(target: string, previous: string): Promise<UpdateRestorePoint> {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  assertIdle(); await saveAndVerify(); assertIdle();
  const registry = useDocumentsStore.getState(), doc = useDocumentStore.getState(), ui = useUIStore.getState();
  const point: UpdateRestorePoint = { schema: 1, dataFormat: 1, target, previous,
    documentId: registry.currentId && registry.docs[registry.currentId] ? registry.currentId : null,
    formType: doc.documentCategory === 'forms' ? doc.formType : undefined,
    section: useEditorOutlineStore.getState().activeId,
    view: { editorLayout: ui.editorLayout, previewVisible: ui.previewVisible, sidebarCollapsed: ui.sidebarCollapsed, sidebarOutlineVisible: ui.sidebarOutlineVisible },
    scroll: editorScroller()?.scrollTop ?? 0 };
  writeUpdateRestore(point); return point;
}
export async function verifyUpdateCheckpoint(point: UpdateRestorePoint) {
  assertIdle(); await saveAndVerify(); assertIdle();
  const registry = useDocumentsStore.getState();
  const current = registry.currentId && registry.docs[registry.currentId] ? registry.currentId : null;
  if (current !== point.documentId) throw new Error('The open document changed while preparing the update. Retry when it is ready.');
}
export function restoreUpdateCheckpoint(currentRelease = __RELEASE_ID__): boolean {
  const point = readUpdateRestore();
  if (!point) return false;
  if (currentRelease !== point.target && !(point.retried && currentRelease === point.previous)) throw new Error('The selected update release did not open');
  const registry = useDocumentsStore.getState();
  if (point.documentId) {
    if (!registry.docs[point.documentId]) throw new Error('The document selected for reopening is no longer in the workspace');
    registry.switchTo(point.documentId);
    if (point.section) useEditorOutlineStore.getState().requestJump(point.documentId, point.section);
  } else registry.newDocument(point.formType);
  useUIStore.setState(point.view); return true;
}
export function finishUpdateRestore(): void {
  const point = readUpdateRestore();
  let failedRelease: string | null = null;
  try {
    if (point?.retried) sessionStorage.setItem(FAILED_RELEASE_KEY, point.target);
    else if (point) sessionStorage.removeItem(FAILED_RELEASE_KEY);
    failedRelease = sessionStorage.getItem(FAILED_RELEASE_KEY);
  } catch { /* A blocked session store must not prevent opening the workspace. */ }
  if (point && (!point.documentId || useDocumentsStore.getState().currentId === point.documentId)) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const editor = editorScroller();
      if (editor) editor.scrollTop = point.scroll;
      clearUpdateRestore();
    }));
  }
  window.__DD_WORKSPACE_READY__ = true;
  if (!failedRelease && /^\/releases\/[^/]+\/index.html$/.test(location.pathname)) {
    const url = new URL(location.href); url.searchParams.delete('appRelease');
    history.replaceState(null, '', '/' + url.search + url.hash);
  }
}
