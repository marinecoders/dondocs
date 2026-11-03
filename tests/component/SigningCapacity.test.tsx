import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { MOASection } from '@/components/editor/MOASection';
import { JointLetterSection } from '@/components/editor/JointLetterSection';
import { JointMemoSection } from '@/components/editor/JointMemoSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useDocumentStore } from '@/stores/documentStore';
import { generateSignatoryTex } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentStore.getState().resetForm();
  useDocumentStore.getState().setFormData({ byDirection: true, byDirectionAuthority: 'the Commanding General' });
  useDocumentStore.setState({ docType: 'naval_letter' });
});

const editor = (docType = 'naval_letter') => render(<TooltipProvider>
  <SignatureSection config={DOC_TYPE_CONFIG[docType]} />
</TooltipProvider>);

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'Signing capacity' }));
  await user.click(screen.getByRole('option', { name }));
}

describe('Signing capacity editor', () => {
  it('switches legacy By direction to Acting, supports a replacement title, then returns to Regular', async () => {
    const user = userEvent.setup();
    editor();
    await user.click(screen.getByText('Signature Block', { exact: true }));
    expect(screen.getByLabelText('Authority (optional)')).toHaveValue('the Commanding General');
    await choose(user, 'Acting');
    expect(useDocumentStore.getState().formData).toMatchObject({ acting: true, byDirection: false });
    expect(screen.queryByLabelText('Authority (optional)')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Acting position (optional)'), 'Deputy');
    expect(useDocumentStore.getState().formData.actingTitle).toBe('Deputy');
    await choose(user, 'By direction');
    expect(useDocumentStore.getState().formData).toMatchObject({ acting: false, byDirection: true });
    expect(screen.getByLabelText('Authority (optional)')).toHaveValue('the Commanding General');
    await choose(user, 'Regular');
    expect(useDocumentStore.getState().formData).toMatchObject({ acting: false, byDirection: false });
  });

  it('does not offer Acting for technical publications', async () => {
    const user = userEvent.setup();
    useDocumentStore.setState({ docType: 'i_type' });
    editor('i_type');
    await user.click(screen.getByText('Signature Block', { exact: true }));
    await user.click(screen.getByRole('combobox', { name: 'Signing capacity' }));
    expect(screen.queryByRole('option', { name: 'Acting' })).not.toBeInTheDocument();
  });

  it('exports the joint memo signer edited beside the Acting control', async () => {
    const user = userEvent.setup();
    useDocumentStore.setState({ docType: 'joint_memorandum' });
    useDocumentStore.getState().setFormData({
      jointSeniorSigName: 'STALE SENIOR', jointJuniorSigName: 'STALE JUNIOR',
      jointSeniorSigTitle: 'Old Senior Title', jointJuniorSigTitle: 'Old Junior Title',
    });
    render(<TooltipProvider><JointMemoSection /></TooltipProvider>);
    const [seniorName, juniorName] = screen.getAllByLabelText('Full Name');
    const [seniorTitle, juniorTitle] = screen.getAllByLabelText('Title');
    expect(seniorName).toHaveValue('STALE SENIOR');
    expect(juniorName).toHaveValue('STALE JUNIOR');
    for (const field of [seniorName, juniorName, seniorTitle, juniorTitle]) await user.clear(field);
    await user.type(seniorName, 'A. PARKER');
    await user.type(juniorName, 'B. RIVERA');
    await user.type(seniorTitle, 'Deputy');
    await user.type(juniorTitle, 'Chief of Staff');
    await user.click(screen.getAllByRole('checkbox', { name: 'Acting' })[0]);

    const input = useDocumentStore.getState();
    for (const output of [generateSignatoryTex(input), generateFlatLatex(input)]) {
      expect(output).toContain('A. PARKER');
      expect(output).toContain('B. RIVERA');
      expect(output).toContain('Deputy');
      expect(output).toContain('Chief of Staff');
      expect(output).not.toContain('STALE');
      expect(output).not.toContain('Old Senior Title');
      expect(output).not.toContain('Old Junior Title');
    }
    await user.clear(seniorName);
    await user.clear(seniorTitle);
    const cleared = useDocumentStore.getState();
    for (const output of [generateSignatoryTex(cleared), generateFlatLatex(cleared)]) {
      expect(output).not.toContain('PARKER');
      expect(output).not.toContain('Deputy');
      expect(output).not.toContain('STALE');
    }
  });

  it.each([
    ['moa', MOASection], ['joint_letter', JointLetterSection], ['joint_memorandum', JointMemoSection],
  ] as const)('%s exposes independent Acting controls for each signer', async (docType, Component) => {
    const user = userEvent.setup();
    useDocumentStore.setState({ docType });
    render(<TooltipProvider><Component /></TooltipProvider>);
    const [senior, junior] = screen.getAllByRole('checkbox', { name: 'Acting' });
    await user.click(junior);
    expect(useDocumentStore.getState().formData).toMatchObject({ juniorActing: true, seniorActing: false });
    await user.click(senior);
    expect(useDocumentStore.getState().formData).toMatchObject({ juniorActing: true, seniorActing: true });
    await user.click(junior);
    expect(useDocumentStore.getState().formData).toMatchObject({ juniorActing: false, seniorActing: true });
  });
});
