import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentGuideModal } from '@/components/modals/DocumentGuideModal';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';

// The finder answers "which format should this be?". Its best match can be
// applied to the open draft from the same screen, through the same switch the
// type picker uses, so the draft keeps its content.

async function answerForABusinessLetter() {
  const user = userEvent.setup();
  render(<DocumentGuideModal />);
  await user.click(screen.getByRole('button', { name: /Answer a few questions/ }));
  for (const answer of [/written correspondence/, /civilian person or business/, /request, recommendation, or tasking/, /Direct to the recipient/, /Formal, on official letterhead/]) {
    await user.click(screen.getByRole('button', { name: answer }));
  }
  return user;
}

describe('document guide recommendation', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
    useDocumentStore.getState().setDocType('naval_letter');
    useUIStore.setState({ documentGuideOpen: true, documentGuideTab: 'browse' });
  });

  it('switches the open draft to the best match and keeps its content', async () => {
    useDocumentStore.getState().setField('subject', 'KEEP THIS SUBJECT');
    const user = await answerForABusinessLetter();
    await user.click(screen.getByRole('button', { name: 'Use Business Letter for this document' }));
    expect(useDocumentStore.getState().docType).toBe('business_letter');
    expect(useDocumentStore.getState().formData.subject).toBe('KEEP THIS SUBJECT');
    expect(useUIStore.getState().documentGuideOpen).toBe(false);
  });

  it('does not offer to apply a NAVMC form as a correspondence type', async () => {
    const user = userEvent.setup();
    render(<DocumentGuideModal />);
    await user.click(screen.getByRole('button', { name: /Answer a few questions/ }));
    await user.click(screen.getByRole('button', { name: /Marine Corps personnel/ }));
    await user.click(screen.getByRole('button', { name: /Make a service-record entry/ }));
    expect(screen.getByText('Recommended Document Types')).toBeVisible();
    expect(screen.queryByRole('button', { name: /for this document/ })).toBeNull();
    expect(useDocumentStore.getState().docType).toBe('naval_letter');
  });

  it('does not switch an open form through the correspondence picker', async () => {
    useDocumentStore.getState().setDocumentCategory('forms');
    await answerForABusinessLetter();
    expect(screen.queryByRole('button', { name: /for this document/ })).toBeNull();
    expect(useDocumentStore.getState().documentCategory).toBe('forms');
  });

  it('says so when the draft already uses the best match', async () => {
    useDocumentStore.getState().setDocType('business_letter');
    await answerForABusinessLetter();
    expect(screen.getByRole('button', { name: 'This document already uses Business Letter' })).toBeDisabled();
  });
});
