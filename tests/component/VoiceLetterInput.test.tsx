import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceLetterInput } from '@/components/modals/VoiceLetterInput';
type Recognition = InstanceType<NonNullable<Window['SpeechRecognition']>>;
class SpeechDouble implements Recognition {
  static instances: SpeechDouble[] = [];
  lang = ''; continuous = false; interimResults = false;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { SpeechDouble.instances.push(this); }
  result(text: string, isFinal = true) { this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] }); }
}
beforeEach(() => {
  SpeechDouble.instances = [];
  vi.stubGlobal('SpeechRecognition', SpeechDouble);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
});
describe('optional reviewed dictation', () => {
  it('requires an explicit start and explicit reviewed insertion', () => {
    const onInsert = vi.fn();
    render(<VoiceLetterInput onInsert={onInsert} />);
    expect(SpeechDouble.instances).toHaveLength(0);
    expect(screen.getByText(/may send microphone audio/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    const speech = SpeechDouble.instances[0];
    expect(speech.start).toHaveBeenCalledOnce();
    act(() => speech.result('From: Commanding Officer', false));
    expect(screen.getByRole('textbox', { name: 'Review dictated text' })).toHaveValue('');
    act(() => speech.result('From: Commanding Officer'));
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add reviewed transcript to letter text' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    act(() => speech.onend?.());
    fireEvent.change(screen.getByRole('textbox', { name: 'Review dictated text' }), { target: { value: 'From: Corrected Officer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reviewed transcript to letter text' }));
    expect(onInsert).toHaveBeenCalledExactlyOnceWith('From: Corrected Officer');
    expect(screen.getByRole('textbox', { name: 'Review dictated text' })).toHaveValue('');
  });

  it('ignores events from earlier or unmounted sessions', () => {
    const { unmount } = render(<VoiceLetterInput onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    const first = SpeechDouble.instances[0]; act(() => first.onend?.());
    fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    const current = SpeechDouble.instances[1];
    act(() => { current.result('Current text'); first.result('Stale text'); first.onerror?.({ error: 'network' }); });
    expect(screen.getByRole('textbox', { name: 'Review dictated text' })).toHaveValue('Current text');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount(); expect(current.abort).toHaveBeenCalledOnce();
    act(() => current.result('Unmounted text'));
  });

  it('explains missing capability and denied permission', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    const { unmount } = render(<VoiceLetterInput onInsert={vi.fn()} />);
    expect(screen.getByText(/unavailable in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start dictation' })).not.toBeInTheDocument(); unmount();
    vi.stubGlobal('SpeechRecognition', SpeechDouble);
    render(<VoiceLetterInput onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    act(() => SpeechDouble.instances[0].onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('permission was denied');
    expect(screen.getByRole('button', { name: 'Start dictation' })).toBeEnabled();
  });

  it('bounds a stuck stop and ignores its eventual late final result', async () => {
    vi.useFakeTimers();
    try {
      render(<VoiceLetterInput onInsert={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
      const speech = SpeechDouble.instances[0]; act(() => speech.result('Captured text'));
      fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      act(() => speech.result('Too late'));
      expect(screen.getByRole('textbox', { name: 'Review dictated text' })).toHaveValue('Captured text');
      expect(speech.abort).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
