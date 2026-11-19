import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProofreadManualChecklist } from '@/components/ProofreadManualChecklist';
import { PROOFREAD_MANUAL_CHECKS } from '@/lib/proofreadChecklist';
import { useProofreadManualChecklist } from '@/hooks/useProofreadManualChecklist';
import type { ProofreadSource } from '@/lib/proofread';

const source: ProofreadSource = { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
  formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [] };

function Checklist({ source, owner }: { source: ProofreadSource; owner: string }) {
  const checks = useProofreadManualChecklist(source, owner);
  return <ProofreadManualChecklist {...checks} />;
}

describe('personal proofread checklist', () => {
  it('keeps personal checks separate and clears them immediately on a new draft or owner', () => {
    const { rerender } = render(<Checklist source={source} owner="one:1" />);
    const checkbox = screen.getByRole('checkbox', { name: /letterhead and its alignment/ });
    fireEvent.click(checkbox);expect(checkbox).toBeChecked();
    expect(screen.getByText('1 of 15 personal checks completed')).toBeInTheDocument();
    rerender(<Checklist source={{ ...source, formData: { subject: 'CHANGED' } }} owner="one:1" />);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);rerender(<Checklist source={source} owner="two:2" />);
    expect(checkbox).not.toBeChecked();
  });
  it('offers the complete source-based checklist without automatic confirmation', () => {
    render(<Checklist source={source} owner="one:1" />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(PROOFREAD_MANUAL_CHECKS.length);
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('group', { name: 'Content' })).toBeInTheDocument();
  });
});
