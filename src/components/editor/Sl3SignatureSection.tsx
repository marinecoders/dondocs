import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentStore } from '@/stores/documentStore';

/** The source authentication prints a name, authority title and program office. */
export function Sl3SignatureSection() {
  const { formData, setField } = useDocumentStore();
  const needsDigital = formData.signatureType !== 'digital' || formData.byDirection;
  const byDirectionTitle = /\bby\s+direction\b/i.test(formData.sigTitle ?? '');

  return (
    <div className="sl3-editor space-y-5">
      <div className="space-y-2">
        <h3 className="text-xl font-medium tracking-tight">Authentication</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Enter the official who will authenticate this publication. MCO 5215.17D
          requires Program Manager or higher authority and prohibits signing by direction.
          Confirm the official's actual authority before release.
        </p>
      </div>
      <div className="sl3-signatory-name-grid">
        {([
          ['sigFirst', 'First name'],
          ['sigMiddle', 'Middle initial'],
          ['sigLast', 'Last name'],
        ] as const).map(([key, label]) => (
          <div key={key} className="min-w-0 space-y-2">
            <Label className="text-sm" htmlFor={`sl3-${key}`}>{label}</Label>
            <Input id={`sl3-${key}`} value={formData[key] ?? ''}
              maxLength={key === 'sigMiddle' ? 3 : undefined}
              onChange={(e) => setField(key, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label className="text-sm" htmlFor="sl3-signing-authority">Signing authority title</Label>
        <Input id="sl3-signing-authority" value={formData.sigTitle ?? ''}
          placeholder="Program Manager" aria-invalid={byDirectionTitle || undefined}
          aria-describedby="sl3-signing-authority-guidance"
          onChange={(e) => setField('sigTitle', e.target.value)} />
        <p id="sl3-signing-authority-guidance" className={`text-xs ${byDirectionTitle ? 'text-destructive' : 'text-muted-foreground'}`}>
          {byDirectionTitle ? 'Remove “by direction” and enter the authorized signing title.' : 'Print the official’s authorized position below their name.'}
        </p>
      </div>
      <div className="space-y-2">
        <Label className="text-sm" htmlFor="sl3-signing-office">Controlling office</Label>
        <Input id="sl3-signing-office" value={formData.controllingOffice ?? ''}
          onChange={(e) => setField('controllingOffice', e.target.value)} />
      </div>
      <div className="flex items-start gap-3 rounded-lg border p-4">
        <Shield className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-sm font-medium">Digital authentication required</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Export prepares an unsigned certificate-signing field between OFFICIAL
            and the printed name. Sign the downloaded PDF with the authorized
            official's certificate before release.
          </p>
          {needsDigital && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                This draft has an incompatible signature setting. Use digital
                authentication without the by-direction option.
              </p>
              <Button variant="outline" size="sm" onClick={() => {
                setField('signatureType', 'digital');
                setField('byDirection', false);
                setField('signatureImage', undefined);
              }}>Use SL-3 authentication</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
