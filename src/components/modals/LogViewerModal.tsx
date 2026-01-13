import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Trash2, Download, Copy, Check } from 'lucide-react';
import { useLogStore, enableConsoleCapture, disableConsoleCapture } from '@/stores/logStore';

export function LogViewerModal() {
  const { logs, isOpen, isEnabled, setOpen, setEnabled, clearLogs } = useLogStore();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  // Enable/disable console capture when toggle changes
  useEffect(() => {
    if (isEnabled) {
      enableConsoleCapture();
    } else {
      disableConsoleCapture();
    }
  }, [isEnabled]);

  const handleCopyLogs = async (e: React.MouseEvent) => {
    // Prevent event from bubbling up and closing the modal
    e.preventDefault();
    e.stopPropagation();

    const text = logs
      .map((log) => `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for browsers without clipboard API or in non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', ''); // Prevent keyboard from showing on mobile
      document.body.appendChild(textArea);

      // On iOS, we need to use setSelectionRange instead of select()
      // and avoid focus() which can cause modal issues
      textArea.setSelectionRange(0, text.length);

      // execCommand returns false if it fails - check the return value
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        console.error('Failed to copy logs: execCommand returned false');
      }
    }
  };

  const handleDownloadLogs = () => {
    const text = logs
      .map((log) => `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `libo-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-500';
      case 'warn':
        return 'text-yellow-500';
      case 'info':
        return 'text-blue-500';
      case 'debug':
        return 'text-gray-400';
      default:
        return 'text-foreground';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Application Logs</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="log-enabled"
                  checked={isEnabled}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                />
                <Label htmlFor="log-enabled" className="text-sm font-normal cursor-pointer">
                  {isEnabled ? 'Logging enabled' : 'Logging disabled'}
                </Label>
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and manage application console logs
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-2">
          <Button variant="outline" size="sm" onClick={handleCopyLogs} disabled={logs.length === 0}>
            {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadLogs} disabled={logs.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button variant="outline" size="sm" onClick={clearLogs} disabled={logs.length === 0}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
          <span className="text-xs text-muted-foreground ml-auto self-center">
            {logs.length} entries
          </span>
        </div>

        <div className="flex-1 overflow-auto bg-black/90 rounded-md p-3 font-mono text-xs min-h-[300px]">
          {!isEnabled && logs.length === 0 && (
            <div className="text-gray-500 text-center py-8">
              Logging is disabled. Enable it above to capture console output.
            </div>
          )}
          {isEnabled && logs.length === 0 && (
            <div className="text-gray-500 text-center py-8">
              No logs yet. Logs will appear here as they are generated.
            </div>
          )}
          {logs.map((log) => (
            <div key={log.id} className="py-0.5 hover:bg-white/5">
              <span className="text-gray-500">
                {log.timestamp.toLocaleTimeString()}.{String(log.timestamp.getMilliseconds()).padStart(3, '0')}
              </span>
              {' '}
              <span className={`font-semibold ${getLevelColor(log.level)}`}>
                [{log.level.toUpperCase()}]
              </span>
              {' '}
              <span className="text-gray-200 whitespace-pre-wrap break-all">
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
