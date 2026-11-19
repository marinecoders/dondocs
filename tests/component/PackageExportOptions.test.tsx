import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackageExportOptions } from '@/components/PackageExportOptions';
import { type ActionPackage, getPackageRevision } from '@/lib/actionPackages';

it.each(['pdf', 'editable'] as const)('allows an unfinished package to transfer as %s', format => {
  const record: ActionPackage = { kind: 'dondocs-action-package-record', version: 1, id: 'package_fixture', name: 'Unfinished draft',
    sequence: 0, archived: false, currentRevisionId: 'revision_fixture', revisions: [{ id: 'revision_fixture', createdAt: 1, members: [], outputs: [] }] };
  render(<PackageExportOptions revision={getPackageRevision(record)} format={format} disabled={false} pdfDisabled={false}
    onFormat={vi.fn()} onPrepare={vi.fn()} onOpenDocument={vi.fn()} />);
  const prepare = screen.getByRole('button', { name: format === 'pdf' ? 'Prepare PDF' : 'Prepare editable package' });
  if (format === 'pdf') expect(prepare).toBeDisabled();
  else expect(prepare).toBeEnabled();
});
