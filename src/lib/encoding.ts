/**
 * Encoding Utilities for DONDOCS
 *
 * Provides consistent encoding/decoding functions for binary data,
 * text, and file operations.
 */

import { debug } from './debug';

/**
 * Convert base64 string to Uint8Array
 * Used for loading binary font files and other assets
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    debug.error('Encoding', 'Failed to decode base64 string', err);
    throw new Error('Invalid base64 string');
  }
}

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  try {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (err) {
    debug.error('Encoding', 'Failed to encode to base64', err);
    throw new Error('Failed to encode bytes to base64');
  }
}

/**
 * Convert ArrayBuffer to Uint8Array
 */
export function arrayBufferToUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

/**
 * Convert Blob to Uint8Array
 */
export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (err) {
    debug.error('Encoding', 'Failed to convert blob to Uint8Array', err);
    throw new Error('Failed to read blob data');
  }
}

/**
 * Convert Uint8Array to Blob
 */
export function uint8ArrayToBlob(bytes: Uint8Array, mimeType: string = 'application/octet-stream'): Blob {
  return new Blob([new Uint8Array(bytes)], { type: mimeType });
}

/**
 * Read file as ArrayBuffer with error handling
 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return ArrayBuffer'));
      }
    };

    reader.onerror = () => {
      debug.error('Encoding', 'FileReader error', reader.error);
      reject(new Error(`Failed to read file: ${reader.error?.message || 'Unknown error'}`));
    };

    reader.onabort = () => {
      debug.warn('Encoding', 'File read aborted');
      reject(new Error('File read was aborted'));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read file as text with error handling
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return string'));
      }
    };

    reader.onerror = () => {
      debug.error('Encoding', 'FileReader error', reader.error);
      reject(new Error(`Failed to read file: ${reader.error?.message || 'Unknown error'}`));
    };

    reader.onabort = () => {
      debug.warn('Encoding', 'File read aborted');
      reject(new Error('File read was aborted'));
    };

    reader.readAsText(file);
  });
}

/**
 * Read file as Data URL (base64) with error handling
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return Data URL'));
      }
    };

    reader.onerror = () => {
      debug.error('Encoding', 'FileReader error', reader.error);
      reject(new Error(`Failed to read file: ${reader.error?.message || 'Unknown error'}`));
    };

    reader.onabort = () => {
      debug.warn('Encoding', 'File read aborted');
      reject(new Error('File read was aborted'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Extract base64 data from a Data URL
 */
export function extractBase64FromDataURL(dataUrl: string): string {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL format');
  }
  return match[1];
}

/**
 * Create a download link and trigger download
 * Properly manages object URL lifecycle
 */
export function triggerDownload(
  data: Uint8Array | Blob,
  filename: string,
  mimeType: string = 'application/octet-stream'
): void {
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoke after a short delay to ensure download starts
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 100);

  debug.log('Encoding', `Download triggered: ${filename}`);
}

/**
 * Escape special characters for LaTeX
 */
export function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (match) => `\\${match}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Strip LaTeX formatting commands for plain text extraction.
 *
 * Hardened against polynomial-time backtracking. The original
 * `[^}]*` body match was O(n) per start position with O(n) potential
 * start positions — adversarial input like `\emph{{|\emph{{|...`
 * (no closing `}` ever) ran in O(n²). 30K-rep input took ~8 s in
 * benchmark; this function is called from `countWords` on every
 * keystroke in the paragraph editor, so a user pasting 30K chars
 * of crafted content would freeze the UI for seconds. Self-DoS,
 * but still poor UX. CodeQL `js/polynomial-redos`.
 *
 * Two-layer defense:
 *   1. Outer length cap — text > 100K chars skips the alternation
 *      regex entirely (uses the simpler unbounded-command strip).
 *      No realistic single paragraph is > 100K chars; for a fuzz /
 *      pathological input we accept slightly less-stripped output
 *      rather than freeze.
 *   2. Bounded-body match — `[^}]{0,2000}` instead of `[^}]*`.
 *      Each start position does at most 2000 char comparisons, so
 *      the polynomial collapses to linear in input size. 2000 is
 *      generous for any realistic emphasized span (typical: 3-50
 *      chars).
 */
const MAX_STRIP_INPUT = 100_000;
const MAX_BODY_CHARS = 2_000;

export function stripLatexFormatting(text: string): string {
  if (text.length > MAX_STRIP_INPUT) {
    // Pathological input: skip the alternation regex (the slow path).
    // Still strip standalone commands + braces so output is closer to
    // plain text than the raw input.
    return text.replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
  }
  return text
    .replace(new RegExp(`\\\\(textbf|textit|underline|emph)\\{([^}]{0,${MAX_BODY_CHARS}})\\}`, 'g'), '$2')
    .replace(new RegExp(`\\\\[a-zA-Z]+\\{([^}]{0,${MAX_BODY_CHARS}})\\}`, 'g'), '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '');
}
