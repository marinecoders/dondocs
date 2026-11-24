import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateSharePassword, MIN_NEW_SHARE_PASSWORD_LENGTH } from '@/lib/shareCrypto';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (password: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
}

export function NewSharePasswordField({ id, label, value, onChange, onSubmit, disabled }: Props) {
  const [generatedVisible, setGeneratedVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={generatedVisible && value ? 'text' : 'password'} autoComplete="new-password"
        value={value} disabled={disabled} aria-describedby={`${id}-hint`} spellCheck={false}
        onChange={event => { setGeneratedVisible(false); onChange(event.target.value); }}
        onKeyDown={event => { if (event.key === 'Enter' && onSubmit) { event.preventDefault(); onSubmit(); } }} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Use at least {MIN_NEW_SHARE_PASSWORD_LENGTH} characters.
        </p>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
          onChange(generateSharePassword());
          setGeneratedVisible(true);
          document.getElementById(id)?.focus();
        }}>Generate password</Button>
      </div>
    </div>
  );
}
