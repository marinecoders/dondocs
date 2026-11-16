import { RUNTIME_BASE } from './releasePaths';

export interface OcrText { text: string; confidence: number }
interface PendingCommand {
  resolve: (data: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Own the pinned Tesseract worker from construction, including initialization. */
export class LocalOcrWorker {
  private readonly worker: Worker;
  private pending = new Map<string, PendingCommand>();
  private sequence = 0;
  private closed = false;
  private readonly signal: AbortSignal;
  private readonly progress: (fraction: number) => void;
  private readonly directory = new URL(`${RUNTIME_BASE}lib/ocr/7.0.0/`, window.location.href).href;
  private readonly abort = () => this.close(new DOMException('Text recognition cancelled.', 'AbortError'));

  constructor(signal: AbortSignal, progress: (fraction: number) => void) {
    this.signal = signal;
    this.progress = progress;
    signal.throwIfAborted();
    this.worker = new Worker(`${this.directory}worker.min.js`);
    this.worker.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    this.worker.onerror = () => this.close(new Error('The local text recognition engine could not start. Reload and try again.'));
    this.worker.onmessageerror = () => this.close(new Error('The text recognition engine returned an unreadable response.'));
    signal.addEventListener('abort', this.abort, { once: true });
  }

  async initialize(): Promise<void> {
    await this.command('load', { options: { lstmOnly: true, corePath: this.directory } });
    await this.command('loadLanguage', { langs: ['eng'], options: {
      langPath: this.directory.replace(/\/$/, ''), cacheMethod: 'none', gzip: true, lstmOnly: true,
    } });
    await this.command('initialize', { langs: ['eng'], oem: 1, config: { tessedit_pageseg_mode: '3' } });
  }

  async recognize(image: Uint8Array): Promise<OcrText> {
    const data = await this.command('recognize', { image, options: {}, output: { text: true } });
    if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string'
      || !('confidence' in data) || typeof data.confidence !== 'number' || !Number.isFinite(data.confidence)) {
      throw new Error('The text recognition engine returned invalid text.');
    }
    if (data.text.length > 500_000) throw new Error('Recognized text exceeds the import limit.');
    return { text: data.text, confidence: Math.max(0, Math.min(100, data.confidence)) };
  }

  close(reason = new Error('Text recognition stopped.')): void {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener('abort', this.abort);
    this.worker.terminate();
    for (const command of this.pending.values()) {
      clearTimeout(command.timeout);
      command.reject(reason);
    }
    this.pending.clear();
  }

  private command(action: string, payload: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new DOMException('Text recognition cancelled.', 'AbortError'));
    const jobId = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.close(new Error('Text recognition timed out. Try fewer pages or a smaller image.')), 90_000);
      this.pending.set(jobId, { resolve, reject, timeout });
      try { this.worker.postMessage({ workerId: 'dondocs-ocr', jobId, action, payload }); }
      catch { this.close(new Error('The source could not be sent to the local text recognition engine.')); }
    });
  }

  private receive(message: unknown): void {
    if (this.closed || !message || typeof message !== 'object' || !('jobId' in message) || typeof message.jobId !== 'string') return;
    const command = this.pending.get(message.jobId);
    if (!command || !('status' in message)) return;
    const data = 'data' in message ? message.data : undefined;
    if (message.status === 'progress') {
      if (data && typeof data === 'object' && 'progress' in data && typeof data.progress === 'number'
        && Number.isFinite(data.progress)) this.progress(Math.max(0, Math.min(1, data.progress)));
      return;
    }
    if (message.status !== 'resolve' && message.status !== 'reject') return;
    this.pending.delete(message.jobId);
    clearTimeout(command.timeout);
    if (message.status === 'resolve') command.resolve(data);
    else this.closeAndReject(command, new Error('The local text recognition engine could not read this source.'));
  }

  private closeAndReject(command: PendingCommand, reason: Error): void {
    command.reject(reason);
    this.close(reason);
  }
}
