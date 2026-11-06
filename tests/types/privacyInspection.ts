import { detectCapturedPII } from '@/services/pii/detector';
import type { CapturedDocument } from '@/lib/capturedDocument';
declare const captured: CapturedDocument;
detectCapturedPII(captured, 'share');
// @ts-expect-error New inspection operations require an issued revision.
detectCapturedPII({ kind: 'correspondence', source: captured.source });
// @ts-expect-error Inspection policy must name the operation's payload.
detectCapturedPII(captured, 'substitution');
