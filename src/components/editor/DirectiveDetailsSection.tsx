import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { directiveHasCancellation, isMarineDirective, isSecnavDirective } from '@/lib/directiveFormats';
import { useDocumentStore } from '@/stores/documentStore';

export function DirectiveDetailsSection() {
  const docType = useDocumentStore(state => state.docType);
  const data = useDocumentStore(state => state.formData);
  const setField = useDocumentStore(state => state.setField);
  const fieldLengths = { directiveChangeNumber: 10, directiveNumber: 120, directiveCancellation: 120, officeCode: 120 };
  const field = (key: 'directiveNumber' | 'directiveCancellation' | 'directiveChangeNumber' | 'officeCode', label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={'admin-' + key}>{label}</Label>
      <Input id={'admin-' + key} value={data[key] ?? ''} placeholder={placeholder} maxLength={fieldLengths[key]}
        onChange={event => setField(key, event.target.value)} />
    </div>
  );

  const change = docType === 'change_transmittal';
  const notice = docType === 'secnav_notice';
  return (
    <div className="space-y-4">
      {field('directiveNumber', change ? 'Original directive identifier' : notice ? 'Notice subject code (SSIC)' : 'Directive number', change ? 'SECNAVINST 5215.1E' : notice ? '5215' : '5215.1K')}
      {field('officeCode', isMarineDirective(docType) ? 'Sponsor code' : 'Originating office code')}
      {change && field('directiveChangeNumber', 'Change number', '1')}
      {change && <p className="text-sm text-muted-foreground">Attach the approved, already numbered replacement pages as PDFs in Enclosures. Export preserves the pages as supplied.</p>}
      {isSecnavDirective(docType) && <p className="text-sm text-muted-foreground">SECNAV requires 12-point Courier New. Compliant mode applies Office of the Secretary letterhead unless you select preprinted stationery.</p>}
      {directiveHasCancellation(docType) && field('directiveCancellation', 'Cancellation line', 'Canc: Sep 2027')}
      {isMarineDirective(docType) && (
        <div className="space-y-1.5">
          <Label htmlFor="directive-reports">Reports required</Label>
          <Textarea maxLength={4000} id="directive-reports" value={data.directiveReports ?? ''}
            onChange={event => setField('directiveReports', event.target.value)} />
        </div>
      )}
    </div>
  );
}
