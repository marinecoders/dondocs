import { captureDocumentScope, isCurrentDocumentScope, type DocumentScope } from '@/stores/documentsStore';

const taskBrand = Symbol('DocumentTask');
export interface DocumentTask { readonly [taskBrand]: true }
type Resource = string | object;
const fields = new Map<string, DocumentTask>();
const items = new WeakMap<object, DocumentTask>();
const tasks = new WeakMap<DocumentTask, { resource: Resource; scope: DocumentScope }>();

/** Capture an activation and supersede earlier work for the same editable resource. */
export function beginDocumentTask(resource: Resource): DocumentTask | null {
  const scope = captureDocumentScope();
  if (!scope) return null;
  const task = Object.freeze<DocumentTask>({ [taskBrand]: true });
  tasks.set(task, { resource, scope });
  if (typeof resource === 'string') fields.set(resource, task);
  else items.set(resource, task);
  return task;
}

export function isCurrentDocumentTask(task: DocumentTask | null): boolean {
  if (!task) return false;
  const owned = tasks.get(task);
  if (!owned || !isCurrentDocumentScope(owned.scope)) return false;
  return (typeof owned.resource === 'string' ? fields.get(owned.resource) : items.get(owned.resource)) === task;
}
