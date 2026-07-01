import { describe, it, expect, vi, beforeEach } from 'vitest';

// A failed IndexedDB read must never be mistaken for an empty library. These
// tests pin the consumer contracts: export refuses, import aborts, and init
// surfaces 'unreadable' instead of hydrating a blank registry.
const getAllMock = vi.fn();
vi.mock('@/lib/documentsDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/documentsDb')>();
  return {
    ...actual,
    idbGetAllDocuments: (...args: unknown[]) => getAllMock(...args),
  };
});

import { exportLibrary, importLibrary, useDocumentsStore, type DocumentEntry } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';

function entry(id: string, updatedAt: number): DocumentEntry {
  return {
    meta: { id, title: `Doc ${id}`, docType: 'naval_letter', updatedAt },
    session: {
      docType: 'naval_letter',
      documentCategory: 'correspondence',
      paragraphs: [{ text: `body ${id}`, level: 0 }],
    },
  } as unknown as DocumentEntry;
}

beforeEach(() => {
  getAllMock.mockReset();
  useUIStore.setState({ storageHealth: 'ok' });
});

describe('exportLibrary — reads the registry the user sees', () => {
  it('serializes the in-memory registry', async () => {
    useDocumentsStore.setState({ hydrated: true, docs: { a: entry('a', 10) } });
    const parsed = JSON.parse(await exportLibrary());
    expect(parsed.kind).toBe('dondocs-library');
    expect(parsed.docs).toHaveLength(1);
    expect(parsed.docs[0].id).toBe('a');
    expect(parsed.docs[0].session.paragraphs[0].text).toBe('body a');
  });

  it('refuses to fabricate a backup when the registry could not be read', async () => {
    useDocumentsStore.setState({ hydrated: true, docs: { a: entry('a', 10) } });
    useUIStore.setState({ storageHealth: 'unreadable' });
    await expect(exportLibrary()).rejects.toThrow(/could not be read/);
  });
});

describe('importLibrary — conflict guard must not fail open', () => {
  it('aborts when the pre-import registry read fails', async () => {
    getAllMock.mockResolvedValue(null);
    const backup = JSON.stringify({ kind: 'dondocs-library', version: 1, docs: [entry('a', 5)] });
    await expect(importLibrary(backup)).rejects.toThrow(/import cancelled/);
  });
});

describe('init — unreadable registry is not an empty one', () => {
  it('rejects and flags storageHealth instead of hydrating blank', async () => {
    getAllMock.mockResolvedValue(null);
    useDocumentsStore.setState({ hydrated: false, docs: {} });
    await expect(useDocumentsStore.getState().init()).rejects.toThrow(/unreadable/);
    expect(useUIStore.getState().storageHealth).toBe('unreadable');
    expect(useDocumentsStore.getState().hydrated).toBe(false);
  });
});
