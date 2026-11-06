import { resolveCapabilities, type CapabilityRequest } from '@/lib/documentCapabilities';
const result = resolveCapabilities({ kind: 'correspondence', docType: 'naval_letter', documentMode: 'compliant' }, { operation: 'export', target: 'pdf' });
// @ts-expect-error Decisions cannot be changed after resolution.
result.status = 'unsupported';
// @ts-expect-error Share operations have a link target.
const invalidShare: CapabilityRequest = { operation: 'share', target: 'pdf' };
// @ts-expect-error Preview is currently a PDF operation.
const invalidPreview: CapabilityRequest = { operation: 'preview', target: 'docx' };
void invalidShare;
void invalidPreview;
