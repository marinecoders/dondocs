import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signaturePresets, type SignatureFormKind } from '@/lib/signaturePresets';
import type { FormSignatureBlock } from '@/types/signature';

/**
 * "Add signature…" split into role presets (Counselor/Originator, Marine
 * acknowledgement, Witness) so a properly-worded block is one click away.
 * Shared by both NAVMC form sections.
 */
export function AddSignatureBlockMenu({
  form,
  onAdd,
  disabled,
}: {
  form: SignatureFormKind;
  onAdd: (block: FormSignatureBlock) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add signature…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {signaturePresets(form).map((preset) => (
          <DropdownMenuItem key={preset.id} onSelect={() => onAdd(preset.make())}>
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
