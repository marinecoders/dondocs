import { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, Replace, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
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

  // Find all matches across paragraphs and form fields
  const matches = useMemo(() => {
    if (!findText.trim()) return [];

    const results: { type: 'paragraph' | 'field'; index: number; field?: string; positions: number[] }[] = [];
    const searchText = caseSensitive ? findText : findText.toLowerCase();

    // Search paragraphs
    paragraphs.forEach((para: Paragraph, index: number) => {
      const text = caseSensitive ? para.text : para.text.toLowerCase();
      const positions: number[] = [];
      let pos = 0;
      while ((pos = text.indexOf(searchText, pos)) !== -1) {
        positions.push(pos);
        pos += searchText.length;
      }
      if (positions.length > 0) {
        results.push({ type: 'paragraph', index, positions });
      }
    });

    // Search key form fields
    const fieldsToSearch: (keyof DocumentData)[] = ['subject', 'from', 'to', 'via'];
    fieldsToSearch.forEach((field: keyof DocumentData) => {
      const value = formData[field] as string || '';
      const text = caseSensitive ? value : value.toLowerCase();
      const positions: number[] = [];
      let pos = 0;
      while ((pos = text.indexOf(searchText, pos)) !== -1) {
        positions.push(pos);
        pos += searchText.length;
      }
      if (positions.length > 0) {
        results.push({ type: 'field', index: -1, field: field as string, positions });
      }
    });

    return results;
  }, [findText, caseSensitive, paragraphs, formData]);

  const totalMatches = useMemo(() => {
    return matches.reduce((sum, m) => sum + m.positions.length, 0);
  }, [matches]);

  // Reset current match when search changes
  useEffect(() => {
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
            const newText = para.text.slice(0, pos) + replaceText + para.text.slice(pos + findText.length);
            updateParagraph(match.index, { text: newText });
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
  }, [matches, currentMatchIndex, findText, replaceText, paragraphs, formData, updateParagraph, setField]);

  const handleReplaceAll = useCallback(() => {
    if (totalMatches === 0 || !findText.trim()) return;

    // Replace in paragraphs
    paragraphs.forEach((para: Paragraph, index: number) => {
      if (caseSensitive) {
        const newText = para.text.split(findText).join(replaceText);
        if (newText !== para.text) {
          updateParagraph(index, { text: newText });
        }
      } else {
        const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const newText = para.text.replace(regex, replaceText);
        if (newText !== para.text) {
          updateParagraph(index, { text: newText });
        }
      }
    });

    // Replace in form fields
    const fieldsToSearch: (keyof DocumentData)[] = ['subject', 'from', 'to', 'via'];
    fieldsToSearch.forEach((field: keyof DocumentData) => {
      const value = formData[field] as string || '';
      if (caseSensitive) {
        const newValue = value.split(findText).join(replaceText);
        if (newValue !== value) {
          setField(field, newValue);
        }
      } else {
        const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const newValue = value.replace(regex, replaceText);
        if (newValue !== value) {
          setField(field, newValue);
        }
      }
    });
  }, [findText, replaceText, caseSensitive, paragraphs, formData, updateParagraph, setField]);

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
            Press Enter or F3 for next match, Shift+Enter for previous. Searches paragraphs, subject, from, to, and via fields.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
