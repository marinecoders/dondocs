/**
 * Component tests for <ReadinessMeter> (the workspace required-field
 * ring). It reads useDocumentCompleteness, which derives from the same
 * getSectionError rule the rail dots use — so these also guard that the meter
 * and the rail agree about "done".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { ReadinessMeter } from '@/components/layout/ReadinessMeter';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fixtureInstance } from '../_helpers/formFixture';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';

// The meter's "jump to first incomplete" control is wrapped in IconTip, which
// relies on the app-root TooltipProvider (App.tsx) — supply one in tests.
function renderMeter() {
  return render(
    <TooltipProvider>
      <ReadinessMeter />
    </TooltipProvider>
  );
}

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

  it('offers the incomplete sections without claiming document readiness', () => {
    renderMeter();
    const meter = screen.getByRole('button', { name: /Required fields:/ });
    expect(meter.getAttribute('aria-label')).toMatch(/0 of 4/);
    expect(screen.getByText('4 incomplete sections')).toBeTruthy();
  });

  it('only affirms required fields once every required section is satisfied', () => {
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
    renderMeter();
    expect(screen.getByText('Required fields complete')).toBeTruthy();
    expect(screen.queryByText('Ready to sign')).not.toBeInTheDocument();
  });

  it('shows the Compliant pill in compliant mode', () => {
    renderMeter();
    expect(screen.getByText('Compliant mode')).toBeTruthy();
  });
  it('routes generic form errors to sections and includes invalid optional answers', () => {
    const instance = fixtureInstance();
    instance.answers.name = '';
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'fixture', genericForm: instance });
    const jump = vi.fn(); useEditorOutlineStore.setState({ jump });
    renderMeter();
    fireEvent.click(screen.getByRole('button', { name: /Required fields:/ }));
    expect(jump).toHaveBeenCalledWith('identity');
    expect(screen.queryByText('Compliant')).toBeNull();
    act(() => useDocumentStore.setState({ genericForm: { ...instance, answers: { ...instance.answers, name: '000123', a: 'invalid boolean' } } }));
    expect(screen.getByText('1 incomplete section')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Required fields:/ }));
    expect(jump).toHaveBeenLastCalledWith('decision');
  });

  it('recognizes a valid optional-only form without claiming it is ready for signing', () => {
    const instance = fixtureInstance();
    for (const field of Object.values(instance.definition.fields)) delete field.requiredAt;
    instance.answers = {};
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'fixture', genericForm: instance });
    renderMeter();
    expect(screen.getByText('Fields complete')).toBeTruthy();
    expect(screen.queryByText('Ready to sign')).toBeNull();
  });

});
