/**
 * Encoding Utilities for LIBO-SECURED
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
 * Strip LaTeX formatting commands for plain text extraction
 */
export function stripLatexFormatting(text: string): string {
  return text
    .replace(/\\(textbf|textit|underline|emph)\{([^}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '');
}
