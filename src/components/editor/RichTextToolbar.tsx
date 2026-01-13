import { Bold, Italic, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RichTextToolbarProps {
  onFormat: (format: 'bold' | 'italic' | 'underline') => void;
}

export function RichTextToolbar({ onFormat }: RichTextToolbarProps) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 mb-2 p-1 bg-secondary/30 rounded-md">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onFormat('bold')}
            >
              <Bold className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Bold (**text**)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onFormat('italic')}
            >
              <Italic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Italic (*text*)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onFormat('underline')}
            >
              <Underline className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Underline (__text__)</p>
          </TooltipContent>
        </Tooltip>

        <span className="text-xs text-muted-foreground ml-2">
          Select text to toggle formatting
        </span>
      </div>
    </TooltipProvider>
  );
}

/**
 * Toggle formatting markers on selected text in a textarea.
 * If the selection already has the formatting, it will be removed.
 * If not, the formatting will be applied.
 */
export function applyFormat(
  textarea: HTMLTextAreaElement,
  format: 'bold' | 'italic' | 'underline'
): string {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selectedText = text.substring(start, end);

  if (!selectedText) return text;

  const markers = {
    bold: { open: '**', close: '**' },
    italic: { open: '*', close: '*' },
    underline: { open: '__', close: '__' },
  };

  const { open, close } = markers[format];

  // Check if the selected text already has this formatting (inside the selection)
  if (selectedText.startsWith(open) && selectedText.endsWith(close) && selectedText.length >= open.length + close.length) {
    // Remove the formatting from inside the selection
    const unformatted = selectedText.slice(open.length, -close.length);
    return text.substring(0, start) + unformatted + text.substring(end);
  }

  // Check if the formatting markers are around the selection (outside)
  const beforeStart = start - open.length;
  const afterEnd = end + close.length;

  if (beforeStart >= 0 && afterEnd <= text.length) {
    const markerBefore = text.substring(beforeStart, start);
    const markerAfter = text.substring(end, afterEnd);

    if (markerBefore === open && markerAfter === close) {
      // Remove the formatting markers from around the selection
      return text.substring(0, beforeStart) + selectedText + text.substring(afterEnd);
    }
  }

  // Apply formatting (wrap selection with markers)
  return text.substring(0, start) + open + selectedText + close + text.substring(end);
}
