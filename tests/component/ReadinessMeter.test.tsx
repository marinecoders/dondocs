/**
 * Component tests for <ReadinessMeter> (the preview "Drafting → Ready to sign"
 * ring). It reads useDocumentCompleteness, which derives from the same
 * getSectionError rule the rail dots use — so these also guard that the meter
 * and the rail agree about "done".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadinessMeter } from '@/components/layout/ReadinessMeter';
import { useDocumentStore } from '@/stores/documentStore';

function configure(formData: Record<string, string>, paragraphs: { text: string }[]) {
  useDocumentStore.setState({
    docType: 'naval_letter',
    documentCategory: 'correspondence',
    documentMode: 'compliant',
    paragraphs: paragraphs as never,
  });
  useDocumentStore.getState().setFormData(formData as never);
}

describe('ReadinessMeter — driven by the single completeness rule', () => {
  beforeEach(() => {
    cleanup();
    // naval_letter requires letterhead/addressing/body/signature; start empty.
    configure({ unitLine1: '', from: '', to: '', subject: '', sigLast: '' }, []);
  });

  it('reads "Drafting" while required sections are unfilled', () => {
    render(<ReadinessMeter />);
    const meter = screen.getByLabelText(/Document readiness/i);
    expect(meter.getAttribute('aria-label')).toMatch(/Drafting/);
    expect(screen.getByText('Drafting')).toBeTruthy();
  });

  it('flips to "Ready to sign" once every required section is satisfied', () => {
    configure(
      {
        unitLine1: '1ST BATTALION, 6TH MARINES',
        from: 'Commanding Officer',
        to: 'Commanding General',
        subject: 'TEST SUBJECT',
        sigLast: 'DOE',
      },
      [{ text: 'The Marine requests special liberty.' }]
    );
    render(<ReadinessMeter />);
    expect(screen.getByText('Ready to sign')).toBeTruthy();
  });

  it('shows the Compliant pill in compliant mode', () => {
    render(<ReadinessMeter />);
    expect(screen.getByText('Compliant')).toBeTruthy();
  });
});
