import { Variable } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BATCH_PLACEHOLDERS } from '@/lib/constants';

interface InsertVariableButtonProps {
  onInsert: (placeholder: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'icon';
  showLabel?: boolean;
}

// Group placeholders by category
const groupedPlaceholders = BATCH_PLACEHOLDERS.reduce((acc, placeholder) => {
  if (!acc[placeholder.category]) {
    acc[placeholder.category] = [];
  }
  acc[placeholder.category].push(placeholder);
  return acc;
}, {} as Record<string, typeof BATCH_PLACEHOLDERS[number][]>);

const categoryOrder = ['Subject', '2nd Person', '3rd Person', 'Dates', 'Contact', 'Document'];

export function InsertVariableButton({ onInsert, disabled, size = 'icon', showLabel }: InsertVariableButtonProps) {
  const handleSelect = (name: string) => {
    onInsert(`{{${name}}}`);
  };

  const isIconOnly = size === 'icon' && !showLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          title="Insert variable for batch generation"
          className={isIconOnly ? 'h-8 w-8 shrink-0' : size === 'sm' ? 'h-7 px-2' : ''}
        >
          <Variable className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          {(showLabel || size === 'default') && <span className="ml-1.5 text-xs">Variable</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Insert a variable for batch generation
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {categoryOrder.map((category, idx) => (
          <div key={category}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs font-medium">{category}</DropdownMenuLabel>
            {groupedPlaceholders[category]?.map((placeholder) => (
              <DropdownMenuItem
                key={placeholder.name}
                onClick={() => handleSelect(placeholder.name)}
                className="flex justify-between cursor-pointer"
              >
                <span>{placeholder.label}</span>
                <code className="text-xs text-muted-foreground bg-muted px-1 rounded">
                  {`{{${placeholder.name}}}`}
                </code>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
