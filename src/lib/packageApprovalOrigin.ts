export function approvalServiceOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? value : null;
  } catch { return null; }
}

export const configuredApprovalOrigin = approvalServiceOrigin(import.meta.env.VITE_DONDOCS_APPROVAL_ORIGIN);
