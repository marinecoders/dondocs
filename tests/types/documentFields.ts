import { capturedTextFields, mapCapturedText } from '@/lib/documentFields';
import type { CapturedDocument } from '@/lib/capturedDocument';
declare const captured: CapturedDocument;
const fields = capturedTextFields(captured, 'output');
mapCapturedText(captured, field => field.text);
// @ts-expect-error Field values belong to the returned read-only projection.
fields[0].text = 'other';
// @ts-expect-error Stable field paths cannot be changed by consumers.
fields[0].path.push('other');
// @ts-expect-error A raw editor-shaped object is not an issued capture.
mapCapturedText({ kind: 'correspondence', source: captured.source }, field => field.text);
