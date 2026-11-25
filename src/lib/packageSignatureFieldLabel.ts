import type { PackageMember } from './actionPackages';

export function packageSignatureFieldLabel(member: PackageMember, field: string): string {
  const definition = member.kind === 'native' ? member.session.genericForm?.definition : undefined;
  const mapped = Object.values(definition?.fields ?? {}).find(entry => entry.sourceIds?.includes(field));
  const name = field.split('.').at(-1)?.replace(/\[\d+\]$/, '').replaceAll('_', ' ');
  return mapped?.label || name || field;
}
