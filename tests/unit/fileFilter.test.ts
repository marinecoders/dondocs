import { describe, it, expect } from 'vitest';
import {
  partitionFiles,
  rejectedFilesMessage,
  isPdfFile,
  isImageFile,
} from '@/lib/fileFilter';

const mkFile = (name: string, type: string): File =>
  new File([''], name, { type });

describe('partitionFiles', () => {
  it('splits into accepted and rejected, preserving order', () => {
    const files = [
      mkFile('a.pdf', 'application/pdf'),
      mkFile('b.png', 'image/png'),
      mkFile('c.pdf', 'application/pdf'),
    ];
    const { accepted, rejected } = partitionFiles(files, isPdfFile);
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'c.pdf']);
    expect(rejected.map((f) => f.name)).toEqual(['b.png']);
  });

  it('handles all-accepted and all-rejected without cross-contamination', () => {
    const imgs = [mkFile('x.png', 'image/png'), mkFile('y.jpg', 'image/jpeg')];
    expect(partitionFiles(imgs, isImageFile).rejected).toHaveLength(0);
    expect(partitionFiles(imgs, isPdfFile).accepted).toHaveLength(0);
  });

  it('returns two empty lists for an empty input', () => {
    expect(partitionFiles([], isPdfFile)).toEqual({ accepted: [], rejected: [] });
  });
});

describe('rejectedFilesMessage', () => {
  it('names the file when exactly one was rejected', () => {
    const msg = rejectedFilesMessage([mkFile('resume.docx', 'application/msword')], 'PDF');
    expect(msg).toContain('resume.docx');
    expect(msg).toContain('PDF');
  });

  it('counts when more than one was rejected', () => {
    const msg = rejectedFilesMessage(
      [mkFile('a.txt', 'text/plain'), mkFile('b.txt', 'text/plain')],
      'PDF'
    );
    expect(msg).toContain('2 files');
  });
});

describe('type predicates', () => {
  it('isPdfFile matches only the PDF mime', () => {
    expect(isPdfFile(mkFile('a.pdf', 'application/pdf'))).toBe(true);
    expect(isPdfFile(mkFile('a.png', 'image/png'))).toBe(false);
  });

  it('isImageFile matches any image/* mime', () => {
    expect(isImageFile(mkFile('a.png', 'image/png'))).toBe(true);
    expect(isImageFile(mkFile('a.gif', 'image/gif'))).toBe(true);
    expect(isImageFile(mkFile('a.pdf', 'application/pdf'))).toBe(false);
  });
});
