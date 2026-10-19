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
import { useFormStore, type NavmcForm10274Data, type Navmc11811Data } from '@/stores/formStore';
import type { DocumentData } from '@/types/document';

export function FindReplaceModal() {
  // Individual selectors — modal only re-renders on its own flag changing.
  const findReplaceOpen = useUIStore((s) => s.findReplaceOpen);
  const setFindReplaceOpen = useUIStore((s) => s.setFindReplaceOpen);
  const { documentCategory, formType, formData, setField, paragraphs, updateParagraph } = useDocumentStore();
  const { navmc10274, navmc11811, setNavmc10274Field, setNavmc11811Field } = useFormStore();

  // Only expose text belonging to the active editor. Never mutate the dormant
  // correspondence state while a NAVMC form is on screen.
  const targets = useMemo(() => {
    if (documentCategory === 'forms') {
      const fields = formType === 'navmc_118_11' ? navmc11811 : navmc10274;
      const update = (key: string, value: string) => {
        if (formType === 'navmc_118_11') setNavmc11811Field(key as keyof Navmc11811Data, value);
        else setNavmc10274Field(key as keyof NavmcForm10274Data, value);
      };
      const textFields = Object.entries(fields).flatMap(([key, value]) => typeof value === 'string'
        ? [{ value, update: (next: string) => update(key, next) }] : []);
      const signatures = fields.signatureBlocks.flatMap((block, index) => (['name', 'statement'] as const).map((key) => ({
        value: block[key] ?? '',
        update: (next: string) => {
          const current = useFormStore.getState();
          const active = formType === 'navmc_118_11' ? current.navmc11811 : current.navmc10274;
          const blocks = active.signatureBlocks.map((item, i) => i === index ? { ...item, [key]: next } : item);
          if (formType === 'navmc_118_11') setNavmc11811Field('signatureBlocks', blocks);
          else setNavmc10274Field('signatureBlocks', blocks);
        },
      })));
      return [...textFields, ...signatures];
    }
    const fields: (keyof DocumentData)[] = ['subject', 'from', 'to', 'via'];
    return [
      ...paragraphs.flatMap((paragraph, index) => (['text', 'header'] as const).map((key) => ({
        value: paragraph[key] ?? '', update: (next: string) => updateParagraph(index, { [key]: next }),
      }))),
      ...fields.map((key) => ({ value: (formData[key] as string) || '', update: (next: string) => setField(key, next) })),
    ];
  }, [documentCategory, formType, navmc10274, navmc11811, setNavmc10274Field, setNavmc11811Field, paragraphs, formData, setField, updateParagraph]);

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

  const matches = useMemo(() => {
    if (!findText.trim()) return [];
    return targets.flatMap((target) => positionsOf(target.value, findText).map((position) => ({ target, position })));
  }, [findText, targets, positionsOf]);

  const totalMatches = matches.length;
  const activeMatchIndex = Math.min(currentMatchIndex, Math.max(0, totalMatches - 1));

  // Reset current match when search changes. The match index is also
  // mutated by user navigation (next/prev buttons), so it can't be
  // purely derived from search inputs -- it has to be state. The lint
  // rule prefers we set it from a callback rather than synchronously
  // in an effect body, but useRegisterSW-style external subscription
  // doesn't apply here (the trigger IS a React prop change). Suppressed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentMatchIndex(0);
  }, [findText, caseSensitive, documentCategory, formType]);

  const handleFindNext = useCallback(() => {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((activeMatchIndex + 1) % totalMatches);
  }, [totalMatches, activeMatchIndex]);

  const handleFindPrevious = useCallback(() => {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((activeMatchIndex - 1 + totalMatches) % totalMatches);
  }, [totalMatches, activeMatchIndex]);

  const handleReplace = useCallback(() => {
    const match = matches[activeMatchIndex];
    if (!match) return;
    const { target, position } = match;
    target.update(target.value.slice(0, position) + replaceText + target.value.slice(position + findText.length));
    setCurrentMatchIndex(activeMatchIndex);
  }, [matches, activeMatchIndex, findText, replaceText]);

  const handleReplaceAll = useCallback(() => {
    if (!findText.trim()) return;
    for (const target of targets) {
      // Replace from the end so offsets stay valid and replacement text is
      // literal (including "$&"), rather than interpreted as regex syntax.
      let next = target.value;
      for (const position of positionsOf(target.value, findText).reverse()) {
        next = next.slice(0, position) + replaceText + next.slice(position + findText.length);
      }
      if (next !== target.value) target.update(next);
    }
    setCurrentMatchIndex(0);
  }, [targets, findText, replaceText, positionsOf]);

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
            Find and replace
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
                placeholder="Search text…"
                autoFocus
              />
              <Button variant="outline" size="icon" aria-label="Previous match" onClick={handleFindPrevious} disabled={totalMatches === 0}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Next match" onClick={handleFindNext} disabled={totalMatches === 0}>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            {findText && (
              <div className="flex items-center gap-2">
                <Badge variant={totalMatches > 0 ? 'default' : 'secondary'}>
                  {totalMatches > 0 ? `${activeMatchIndex + 1} of ${totalMatches}` : 'No matches'}
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
                placeholder="Replacement text…"
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
            Press Enter or F3 for next match, Shift+Enter for previous. {documentCategory === 'forms'
              ? 'Searches the active form’s text fields and signatures.'
              : 'Searches paragraph text and headings, plus the subject, from, to, and via fields.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
