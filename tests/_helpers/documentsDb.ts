/**
 * Reading the document store in a test.
 *
 * `idbGetAllDocuments` answers `null` when the read itself failed, which is
 * never what a test is asking about: it means the fixture database never
 * opened. Separating that from an empty store keeps a failure honest, and
 * keeps the caller's assertion about the documents.
 */
import type { StoredDocument } from '@/lib/documentsDb';

export function documentsRead(all: StoredDocument[] | null): StoredDocument[] {
  if (!all) { throw new Error('idbGetAllDocuments answered null: the test database could not be read'); }
  return all;
}
