import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  signaturePresets,
  type SignatureFormKind,
  type SignaturePresetNames,
} from '@/lib/signaturePresets';
import type { FormSignatureBlock } from '@/types/signature';

/**
 * "Add signature…" split into role presets (Counselor/Originator, Marine
 * acknowledgement, Witness) so a properly-worded block is one click away.
 * Shared by both NAVMC form sections. `names` pre-fills typed names the app
 * already knows (profile signer, the 118(11)'s Marine) — editable, never
 * locked.
 */
export function AddSignatureBlockMenu({
  form,
  onAdd,
  disabled,
  names,
}: {
  form: SignatureFormKind;
  /**
   * Called with the new block. May return a focus callback (e.g. "focus the
   * new block's first input") — the menu runs it when it closes, at the exact
   * moment Radix would otherwise return focus to the trigger. Timing matters:
   * the menu's exit animation means close cleanup outlives any fixed-frame
   * deferral a caller could schedule, so the menu must own this hand-off.
   */
  onAdd: (block: FormSignatureBlock) => void | (() => void);
  disabled?: boolean;
  names?: SignaturePresetNames;
}) {
  // Set only when a preset was chosen; an Escape dismissal leaves it null and
  // keeps Radix's normal focus-return to the trigger.
  const focusAfterClose = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add signature…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(e) => {
          if (focusAfterClose.current) {
            e.preventDefault();
            focusAfterClose.current();
            focusAfterClose.current = null;
          }
        }}
      >
        {signaturePresets(form, names).map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            onSelect={() => {
              const focus = onAdd(preset.make());
              focusAfterClose.current = typeof focus === 'function' ? focus : null;
            }}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
