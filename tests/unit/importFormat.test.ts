import { describe, it, expect } from 'vitest';
import { detectImportFormat, isDocxFile, isLegacyDocFile, DOCX_MIME } from '@/lib/importFormat';

// detectImportFormat/isDocxFile read only name + type, so a lightweight stand-in
// avoids constructing a real File in the node test environment.
const asFile = (name: string, type = '') => ({ name, type }) as Pick<File, 'name' | 'type'>;
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]); // PK\x03\x04 (docx/zip)
const GARBAGE = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

describe('detectImportFormat — extension / MIME (trusted first)', () => {
  it('routes a .docx name to docx', () => {
    expect(detectImportFormat(asFile('letter.docx'), GARBAGE)).toBe('docx');
  });
  it('routes a .pdf name to pdf', () => {
    expect(detectImportFormat(asFile('letter.pdf'), GARBAGE)).toBe('pdf');
  });
  it('routes by the Word MIME type when the name is unhelpful', () => {
    expect(detectImportFormat(asFile('download', DOCX_MIME), GARBAGE)).toBe('docx');
  });
  it('routes by the PDF MIME type', () => {
    expect(detectImportFormat(asFile('download', 'application/pdf'), GARBAGE)).toBe('pdf');
  });
});

describe('detectImportFormat — magic-byte fallback', () => {
  it('detects a PDF from %PDF when the file has no useful name or type', () => {
    expect(detectImportFormat(asFile('', 'application/octet-stream'), PDF_MAGIC)).toBe('pdf');
  });
  it('detects a DOCX from the PK zip header when mislabeled', () => {
    expect(detectImportFormat(asFile('report', ''), ZIP_MAGIC)).toBe('docx');
  });
  it('returns null when nothing identifies the format', () => {
    expect(detectImportFormat(asFile('mystery.txt', 'text/plain'), GARBAGE)).toBeNull();
  });
  it('extension still wins over magic bytes (a named .pdf is read as PDF)', () => {
    // Trust the user-facing extension first; magic bytes are only the fallback.
    expect(detectImportFormat(asFile('letter.pdf'), ZIP_MAGIC)).toBe('pdf');
  });
});

describe('isDocxFile', () => {
  it('matches by extension and by MIME, and rejects a PDF', () => {
    expect(isDocxFile(asFile('a.docx'))).toBe(true);
    expect(isDocxFile(asFile('a', DOCX_MIME))).toBe(true);
    expect(isDocxFile(asFile('a.pdf', 'application/pdf'))).toBe(false);
  });
});

describe('isLegacyDocFile', () => {
  const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  it('recognizes a legacy .doc by extension and by the msword MIME', () => {
    expect(isLegacyDocFile(asFile('memo.doc'))).toBe(true);
    expect(isLegacyDocFile(asFile('memo', 'application/msword'))).toBe(true);
  });
  it('recognizes the OLE compound-file magic when bytes are provided', () => {
    expect(isLegacyDocFile(asFile('memo'), OLE)).toBe(true);
  });
  it('does not flag a modern .docx as legacy (".doc$" excludes ".docx")', () => {
    expect(isLegacyDocFile(asFile('memo.docx', DOCX_MIME))).toBe(false);
  });
  it('does not flag a PDF', () => {
    expect(isLegacyDocFile(asFile('memo.pdf', 'application/pdf'), PDF_MAGIC)).toBe(false);
  });
});
