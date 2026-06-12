/**
 * Regression (audit critical #4): the "Report a bug" flows embedded
 * document content into a public GitHub issue URL — the compile log
 * (verbatim letter text), in-app logs, and the full window.location.href
 * (which carries the #s=<ciphertext> share payload). That contradicts the
 * "no data ever leaves your browser" promise. Reports now carry only
 * origin+pathname (no hash/query) and never auto-embed logs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { safeReportUrl, BUG_REPORT_PRIVACY_NOTICE, BUG_REPORT_LOG_PROMPT } from '@/lib/bugReport';

describe('bug report URL sanitization (critical #4)', () => {
  const realHref = Object.getOwnPropertyDescriptor(window, 'location');

  beforeEach(() => {
    // Simulate the app opened from a share link.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://dondocs.example',
        pathname: '/app/',
        search: '?ref=email',
        hash: '#s=ENCRYPTED_DOCUMENT_PAYLOAD',
        href: 'https://dondocs.example/app/?ref=email#s=ENCRYPTED_DOCUMENT_PAYLOAD',
      },
    });
  });

  afterEach(() => {
    if (realHref) Object.defineProperty(window, 'location', realHref);
  });

  it('safeReportUrl strips the hash (share payload) and query', () => {
    const url = safeReportUrl();
    expect(url).toBe('https://dondocs.example/app/');
    expect(url).not.toContain('ENCRYPTED_DOCUMENT_PAYLOAD');
    expect(url).not.toContain('#');
    expect(url).not.toContain('?');
  });

  it('the log prompt asks the user to paste, never auto-embeds content', () => {
    expect(BUG_REPORT_LOG_PROMPT).toContain('Copy logs');
    expect(BUG_REPORT_LOG_PROMPT).not.toContain('ENCRYPTED');
    // It is an empty fenced block, not pre-populated content.
    expect(BUG_REPORT_LOG_PROMPT).toContain('```\n\n```');
  });

  it('the privacy notice warns about public GitHub + CUI', () => {
    expect(BUG_REPORT_PRIVACY_NOTICE.toLowerCase()).toContain('public');
    expect(BUG_REPORT_PRIVACY_NOTICE).toContain('CUI');
  });
});
