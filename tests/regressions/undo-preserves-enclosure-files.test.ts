/**
 * Regression (audit C-9): undo permanently destroyed attached enclosure
 * PDF bytes. History snapshots intentionally omit `file` (too large), but
 * `applySnapshot` replaced `enclosures` wholesale — so attach → edit →
 * Ctrl+Z dropped the bytes, redo could not recover them, and the next
 * download silently omitted the pages. `applySnapshot` now re-grafts the
 * live file bytes onto restored enclosures (index+title match first, then
 * any unused title match).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';

const FILE_A = { name: 'a.pdf', size: 3, data: new ArrayBuffer(3) };
const FILE_B = { name: 'b.pdf', size: 5, data: new ArrayBuffer(5) };

describe('applySnapshot re-grafts enclosure file bytes (C-9)', () => {
  beforeEach(() => {
    useDocumentStore.setState({ enclosures: [] });
  });

  it('undo keeps the attached file when the enclosure survives in the snapshot', () => {
    const store = useDocumentStore.getState();
    useDocumentStore.setState({
      enclosures: [{ title: 'Roster', file: FILE_A, pageStyle: 'border' }],
    });
    // Snapshot as history stores it: same enclosure, file stripped.
    store.applySnapshot({
      documentMode: 'correspondence',
      docType: 'naval_letter',
      formData: {},
      references: [],
      enclosures: [{ title: 'Roster', pageStyle: 'border' }],
      paragraphs: [],
      copyTos: [],
      distributions: [],
    } as never);
    expect(useDocumentStore.getState().enclosures[0].file).toBe(FILE_A);
  });

  it('matches by title when order changed; never duplicates one file onto two', () => {
    const store = useDocumentStore.getState();
    useDocumentStore.setState({
      enclosures: [
        { title: 'Roster', file: FILE_A },
        { title: 'Report', file: FILE_B },
      ],
    });
    store.applySnapshot({
      documentMode: 'correspondence',
      docType: 'naval_letter',
      formData: {},
      references: [],
      enclosures: [{ title: 'Report' }, { title: 'Roster' }, { title: 'Roster' }],
      paragraphs: [],
      copyTos: [],
      distributions: [],
    } as never);
    const enc = useDocumentStore.getState().enclosures;
    expect(enc[0].file).toBe(FILE_B);
    expect(enc[1].file).toBe(FILE_A);
    expect(enc[2].file).toBeUndefined(); // FILE_A already used once
  });

  it('enclosures removed before the snapshot stay file-less (no resurrection)', () => {
    const store = useDocumentStore.getState();
    useDocumentStore.setState({ enclosures: [{ title: 'Other', file: FILE_A }] });
    store.applySnapshot({
      documentMode: 'correspondence',
      docType: 'naval_letter',
      formData: {},
      references: [],
      enclosures: [{ title: 'Unrelated' }],
      paragraphs: [],
      copyTos: [],
      distributions: [],
    } as never);
    expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  });
});
