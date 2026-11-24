import { useState } from 'react';
import { Mic } from 'lucide-react';
import { VoiceLetterInput } from '@/components/modals/VoiceLetterInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, recordDocumentHistory, useDocumentsStore, type DocumentScope } from '@/stores/documentsStore';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { planParagraphDictation } from '@/lib/paragraphDictation';

interface Draft {
  scope: DocumentScope;
  paragraphId: string;
  before: string;
}

export function ParagraphDictationButton({ paragraphId, index }: { paragraphId: string; index: number }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [transcript, setTranscript] = useState('');
  const [interpret, setInterpret] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const currentEpoch = useDocumentsStore(s => s.activationEpoch);
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return null;
  const open = draft?.scope.epoch === currentEpoch;

  function changeOpen(value: boolean) {
    if (!value) {
      setDraft(null);
      return;
    }
    const scope = captureDocumentScope();
    const paragraph = useDocumentStore.getState().paragraphs.find(item => item.id === paragraphId);
    if (!scope || !paragraph) return;
    setTranscript('');
    setInterpret(false);
    setError('');
    setStatus('');
    setDraft({ scope, paragraphId, before: paragraph.text });
  }

  function applyTranscript(value: string): boolean {
    const state = useDocumentStore.getState();
    if (!draft || !isCurrentDocumentScope(draft.scope) || deriveOverallClassLevel(state.formData.classLevel, state.paragraphs) !== 'unclassified') {
      setError('This document changed. Close this window to start again.');
      return false;
    }
    recordDocumentHistory(draft.scope);
    if (!state.applyDictation(draft.paragraphId, draft.before, planParagraphDictation(value, interpret))) {
      setError('The paragraph changed or the transcript exceeds the editor limits. Check the text before trying again.');
      return false;
    }
    recordDocumentHistory(draft.scope);
    setDraft(null);
    setStatus('Dictation added. Use Undo to restore the previous draft.');
    return true;
  }

  const title = `Dictate into paragraph ${index + 1}`;
  return <>
    <span role="status" className="sr-only">{status}</span>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-6 sm:w-6" aria-label={title} title="Dictate into paragraph">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      {open && <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Review what was captured. Applying adds it to the end of this paragraph. One Undo restores the draft.</DialogDescription>
        </DialogHeader>
        <VoiceLetterInput forParagraph onTranscriptChange={setTranscript} onInsert={applyTranscript} beforeApply={
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={interpret} onChange={event => setInterpret(event.target.checked)} /> Interpret spoken commands
            </label>
            {interpret && <div className="min-w-0 space-y-2 text-sm">
              <p>Say “command” before period, comma, question mark, new line, or new paragraph. Say “command indent” just after starting a new paragraph.</p>
              {transcript.trim() && <div aria-label="Interpreted text" className="max-h-36 overflow-auto rounded border p-2">
                {planParagraphDictation(transcript, true).map((part, partIndex) => <p key={partIndex} className="whitespace-pre-wrap break-words">
                  <span className="font-medium">{partIndex === 0 ? 'Append: ' : part.indent ? 'New indented paragraph: ' : 'New paragraph: '}</span>{part.text}
                </p>)}
              </div>}
            </div>}
          </div>
        } />
        {error && <p role="alert" className="text-sm text-warning">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => changeOpen(false)}>Cancel</Button></DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
}
