// Exercise the shared catalog controls even when no built-in recipes are published.
import { vi } from 'vitest';

vi.mock('@/lib/maintainedPackageActions', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/maintainedPackageActions')>();
  const fixtures = [
    ['administrative-request', 'Administrative request'],
    ['training-participation', 'Training participation'],
    ['evidence-submission', 'Evidence submission'],
  ].map(([id, name]) => ({ id, name, description: '', kind: 'Test recipe' }));
  return { ...actual, maintainedPackageActions: [...actual.maintainedPackageActions, ...fixtures] };
});
