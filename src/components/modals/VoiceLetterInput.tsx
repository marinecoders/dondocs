import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
interface RecognitionConstructor { new(): Recognition }
declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}
const MAX_TRANSCRIPT = 50_000;

/** Dictation is opt-in and reviewed before it reaches even the pending letter text. */
export function VoiceLetterInput({ onInsert, initialTranscript = '', onTranscriptChange, onActiveChange }: {
  onInsert: (text: string) => void;
  initialTranscript?: string;
  onTranscriptChange?: (text: string) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const active = useRef<Recognition | null>(null);
  const finishingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'idle' | 'listening' | 'finishing'>('idle');
  const [text, setLocalText] = useState(initialTranscript);
  function setText(value: string) { setLocalText(value); onTranscriptChange?.(value); }
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const isActive = status !== 'idle';
  useEffect(() => {
    onActiveChange?.(isActive);
    return () => onActiveChange?.(false);
  }, [isActive, onActiveChange]);
  useEffect(() => () => {
    const recognition = active.current; active.current = null;
    if (finishingTimer.current) clearTimeout(finishingTimer.current);
    recognition?.abort();
  }, []);

  function start() {
    if (!Constructor || active.current) return;
    const previousText = text.trim();
    setInterim(''); setError('');
    let recognition: Recognition;
    try { recognition = new Constructor(); }
    catch { setError('This browser could not open speech recognition. You can type or paste text instead.'); return; }
    active.current = recognition;
    recognition.lang = 'en-US'; recognition.continuous = true; recognition.interimResults = true;
    const finish = () => {
      if (active.current !== recognition) return;
      active.current = null;
      if (finishingTimer.current) clearTimeout(finishingTimer.current);
      finishingTimer.current = null; setStatus('idle'); setInterim('');
    };
    recognition.onresult = event => {
      if (active.current !== recognition) return;
      const final: string[] = [], pending: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        (result.isFinal ? final : pending).push(result[0].transcript);
      }
      const value = [previousText, final.join(' ').trim()].filter(Boolean).join('\n');
      setText(value.slice(0, MAX_TRANSCRIPT)); setInterim(pending.join(' ').slice(0, 2000));
      if (value.length > MAX_TRANSCRIPT) {
        setError('The transcript reached its 50,000-character limit. Review it before inserting.');
        finish(); recognition.abort();
      }
    };
    recognition.onerror = event => {
      if (active.current !== recognition) return;
      const messages: Record<string, string> = {
        'not-allowed': 'Microphone or speech recognition permission was denied. You can enter or paste text instead.',
        'service-not-allowed': 'This browser does not permit speech recognition. You can enter or paste text instead.',
        'no-speech': 'No speech was recognized. Try again or enter text.',
        'audio-capture': 'A microphone could not be opened. Check your microphone and browser permissions.',
        network: 'The browser speech service could not connect. You can enter or paste text instead.',
      };
      setError(messages[event.error] ?? 'Dictation stopped. Review any captured text or try again.'); finish(); recognition.abort();
    };
    recognition.onend = finish;
    try { setStatus('listening'); recognition.start(); }
    catch { setError('Dictation could not start. Check browser support and microphone permissions.'); finish(); recognition.abort(); }
  }
  function stop() {
    const recognition = active.current;
    if (!recognition) return;
    setStatus('finishing');
    finishingTimer.current = setTimeout(() => {
      if (active.current !== recognition) return;
      active.current = null; recognition.abort(); setStatus('idle'); setInterim('');
      setError('Dictation stopped before the last response arrived. Review the captured text.');
    }, 5000);
    try { recognition.stop(); }
    catch { active.current = null; recognition.abort(); setStatus('idle'); setInterim(''); }
  }
  return <section aria-label="Optional dictation" className="space-y-2 rounded border p-3">
    <p className="text-sm font-medium">Optional dictation</p>
    {!Constructor ? <p className="text-xs text-muted-foreground">Speech recognition is unavailable in this browser. You can type or paste letter text above.</p> : <>
      <p id="voice-privacy" className="text-xs text-muted-foreground">Your browser may send microphone audio to its speech provider. Use dictation only where your organization permits that service. It requires microphone permission and may require an internet connection. File OCR remains local.</p>
      <div className="flex gap-2">
        <Button variant="outline" aria-describedby="voice-privacy" disabled={status !== 'idle'} onClick={start}>Start dictation</Button>
        <Button variant="outline" disabled={status !== 'listening'} onClick={stop}>Stop dictation</Button>
      </div>
      {status !== 'idle' && <p role="status" className="text-xs">{status === 'listening' ? 'Listening…' : 'Finishing dictation…'} {interim}</p>}
      <label htmlFor="voice-transcript" className="block text-sm">Review dictated text</label>
      <Textarea id="voice-transcript" value={text} maxLength={MAX_TRANSCRIPT} disabled={status !== 'idle'} onChange={event => setText(event.target.value)} className="h-28 field-sizing-fixed" />
      <Button variant="outline" disabled={status !== 'idle' || !text.trim()} onClick={() => {
        try { onInsert(text.trim()); setText(''); setError(''); }
        catch { setError('The transcript could not be added. Copy it or try again.'); }
      }}>Add reviewed transcript to letter text</Button>
    </>}
    {error && <p role="alert" className="text-xs text-warning">{error}</p>}
  </section>;
}
