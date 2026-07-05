import { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, Replace, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import type { Paragraph, DocumentData } from '@/types/document';

export function FindReplaceModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const findReplaceOpen = useUIStore((s) => s.findReplaceOpen);
  const setFindReplaceOpen = useUIStore((s) => s.setFindReplaceOpen);
  const { formData, setField, paragraphs, updateParagraph } = useDocumentStore();

  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // All positions of `needle` in `haystack` (respecting case sensitivity).
  const positionsOf = useCallback(
    (haystack: string, needle: string): number[] => {
      const h = caseSensitive ? haystack : haystack.toLowerCase();
      const n = caseSensitive ? needle : needle.toLowerCase();
      const out: number[] = [];
      let pos = 0;
      while ((pos = h.indexOf(n, pos)) !== -1) {
        out.push(pos);
        pos += n.length;
      }
      return out;
    },
    [caseSensitive]
  );

  // Find all matches across paragraph bodies, paragraph headings, and form fields.
  const matches = useMemo(() => {
    if (!findText.trim()) return [];

    const results: {
      type: 'paragraph' | 'field';
      index: number;
      target?: 'text' | 'header';
      field?: string;
      positions: number[];
    }[] = [];

    // Search paragraph bodies and — the bug this fixes — their headings, which a
    // find/replace-all used to skip entirely.
    paragraphs.forEach((para: Paragraph, index: number) => {
      const textPos = positionsOf(para.text, findText);
      if (textPos.length > 0) results.push({ type: 'paragraph', index, target: 'text', positions: textPos });
      const headerPos = para.header ? positionsOf(para.header, findText) : [];
      if (headerPos.length > 0) results.push({ type: 'paragraph', index, target: 'header', positions: headerPos });
    });

    // Search key form fields
    const fieldsToSearch: (keyof DocumentData)[] = ['subject', 'from', 'to', 'via'];
    fieldsToSearch.forEach((field: keyof DocumentData) => {
      const positions = positionsOf((formData[field] as string) || '', findText);
      if (positions.length > 0) results.push({ type: 'field', index: -1, field: field as string, positions });
    });

    return results;
  }, [findText, paragraphs, formData, positionsOf]);

  const totalMatches = useMemo(() => {
    return matches.reduce((sum, m) => sum + m.positions.length, 0);
  }, [matches]);

  // Reset current match when search changes. The match index is also
  // mutated by user navigation (next/prev buttons), so it can't be
  // purely derived from search inputs -- it has to be state. The lint
  // rule prefers we set it from a callback rather than synchronously
  // in an effect body, but useRegisterSW-style external subscription
  // doesn't apply here (the trigger IS a React prop change). Suppressed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentMatchIndex(0);
  }, [findText, caseSensitive]);

  const handleFindNext = useCallback(() => {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % totalMatches);
  }, [totalMatches]);

  const handleFindPrevious = useCallback(() => {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + totalMatches) % totalMatches);
  }, [totalMatches]);

  const handleReplace = useCallback(() => {
    if (totalMatches === 0 || !findText.trim()) return;

    // Find which match we're on
    let matchCount = 0;
    for (const match of matches) {
      for (let i = 0; i < match.positions.length; i++) {
        if (matchCount === currentMatchIndex) {
          // Found the current match, replace it
          if (match.type === 'paragraph') {
            const para = paragraphs[match.index];
            const pos = match.positions[i];
            const src = match.target === 'header' ? para.header ?? '' : para.text;
            const replaced = src.slice(0, pos) + replaceText + src.slice(pos + findText.length);
            updateParagraph(match.index, match.target === 'header' ? { header: replaced } : { text: replaced });
          } else if (match.field) {
            const value = formData[match.field as keyof typeof formData] as string || '';
            const pos = match.positions[i];
            const newValue = value.slice(0, pos) + replaceText + value.slice(pos + findText.length);
            setField(match.field as keyof typeof formData, newValue);
          }
          return;
        }
        matchCount++;
      }
    }
    // `totalMatches` is derived from `matches` via useMemo so it's
    // already covered by the `matches` dep, but exhaustive-deps wants
    // it spelled out explicitly. It's a memoized number — re-listing
    // it adds no extra invalidations.
  }, [matches, totalMatches, currentMatchIndex, findText, replaceText, paragraphs, formData, updateParagraph, setField]);

  const handleReplaceAll = useCallback(() => {
    if (totalMatches === 0 || !findText.trim()) return;

    const replaceIn = (src: string): string => {
      if (caseSensitive) return src.split(findText).join(replaceText);
      const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return src.replace(regex, replaceText);
    };

    // Replace in paragraph bodies AND headings (headings were previously skipped).
    paragraphs.forEach((para: Paragraph, index: number) => {
      const patch: Partial<Paragraph> = {};
      const newText = replaceIn(para.text);
      if (newText !== para.text) patch.text = newText;
      if (para.header) {
        const newHeader = replaceIn(para.header);
        if (newHeader !== para.header) patch.header = newHeader;
      }
      if (Object.keys(patch).length > 0) updateParagraph(index, patch);
    });

    // Replace in form fields
    const fieldsToSearch: (keyof DocumentData)[] = ['subject', 'from', 'to', 'via'];
    fieldsToSearch.forEach((field: keyof DocumentData) => {
      const value = (formData[field] as string) || '';
      const newValue = replaceIn(value);
      if (newValue !== value) setField(field, newValue);
    });
    // Same as handleReplace above: `totalMatches` is derived from
    // `matches` (via useMemo) so re-listing it is redundant but
    // satisfies exhaustive-deps without changing invalidation
    // behavior.
  }, [totalMatches, findText, replaceText, caseSensitive, paragraphs, formData, updateParagraph, setField]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!findReplaceOpen) return;

      if (e.key === 'Enter' || e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) {
          handleFindPrevious();
        } else {
          handleFindNext();
        }
      }

      if (e.key === 'Escape') {
        setFindReplaceOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [findReplaceOpen, handleFindNext, handleFindPrevious, setFindReplaceOpen]);

  return (
    <Dialog open={findReplaceOpen} onOpenChange={setFindReplaceOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Find & Replace
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search the document body for text and optionally replace matches.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Find */}
          <div className="space-y-2">
            <Label htmlFor="find">Find</Label>
            <div className="flex gap-2">
              <Input
                id="find"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="Search text..."
                autoFocus
              />
              <Button variant="outline" size="icon" onClick={handleFindPrevious} disabled={totalMatches === 0}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={handleFindNext} disabled={totalMatches === 0}>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            {findText && (
              <div className="flex items-center gap-2">
                <Badge variant={totalMatches > 0 ? 'default' : 'secondary'}>
                  {totalMatches > 0 ? `${currentMatchIndex + 1} of ${totalMatches}` : 'No matches'}
                </Badge>
              </div>
            )}
          </div>

          {/* Replace */}
          <div className="space-y-2">
            <Label htmlFor="replace">Replace with</Label>
            <div className="flex gap-2">
              <Input
                id="replace"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replacement text..."
              />
              <Button variant="outline" onClick={handleReplace} disabled={totalMatches === 0}>
                <Replace className="h-4 w-4 mr-1" />
                Replace
              </Button>
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                id="caseSensitive"
                checked={caseSensitive}
                onCheckedChange={(checked) => setCaseSensitive(!!checked)}
              />
              <Label htmlFor="caseSensitive" className="text-sm font-normal cursor-pointer">
                Case sensitive
              </Label>
            </div>
            <Button variant="outline" onClick={handleReplaceAll} disabled={totalMatches === 0}>
              Replace All
            </Button>
          </div>

          {/* Help text */}
          <p className="text-xs text-muted-foreground">
            Press Enter or F3 for next match, Shift+Enter for previous. Searches paragraph text and headings, plus the subject, from, to, and via fields.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
