/**
 * Component tests for <AcronymCheck>. It reads the body paragraphs from the
 * document store and warns about acronyms used before they're defined — these
 * lock in that it's silent on a clean body and cites the governing rule when it
 * fires.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AcronymCheck } from '@/components/editor/AcronymCheck';
import { useDocumentStore } from '@/stores/documentStore';

const setBody = (text: string, docType = 'naval_letter') =>
  useDocumentStore.setState({ paragraphs: [{ text, level: 0 }], docType });

beforeEach(() => useDocumentStore.setState({ paragraphs: [], docType: 'naval_letter' }));

describe('AcronymCheck', () => {
  it('renders nothing when the body defines its acronyms', () => {
    const { container } = render(<AcronymCheck />);
    setBody('The Joint Task Force Headquarters (JTFHQ) met. The JTFHQ reports weekly.');
    // Re-render with the new store state.
    render(<AcronymCheck />);
    expect(container.textContent).toBe('');
  });

  it('warns, listing the undefined acronym and citing SECNAV M-5216.5 ¶17c', () => {
    setBody('The JTFHQ will convene a board and forward the C4ISR plan.');
    render(<AcronymCheck />);
    expect(screen.getByText(/Spell out on first use/i)).toBeTruthy();
    expect(screen.getByText('JTFHQ')).toBeTruthy();
    expect(screen.getByText('C4ISR')).toBeTruthy();
    expect(screen.getByText(/SECNAV M-5216\.5 ¶17c/)).toBeTruthy();
  });

  it('does not warn about universally understood abbreviations', () => {
    setBody('The USMC and DoD concur; the POC is the S-1.');
    const { container } = render(<AcronymCheck />);
    expect(container.textContent).toBe('');
  });
});
