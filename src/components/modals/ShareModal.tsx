/**
 * Share Modal
 *
 * Share: encrypt current document with password, copy link to clipboard.
 * Import: paste share link, enter password, decrypt and load document.
 */

import { useState, useCallback } from 'react';
import { Link2, KeyRound, Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  encryptSharePayload,
  decryptSharePayload,
  buildShareUrl,
  parseShareUrl,
} from '@/lib/shareCrypto';
import { getSerializedSessionForShare, loadSharedSession } from '@/stores/documentStore';
import type { SerializedSession } from '@/stores/documentStore';

export type ShareModalMode = 'share' | 'import';

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ShareModalMode;
  /** When opening from URL hash, pass the extracted payload so user only enters password */
  initialPayload?: string | null;
  onImportComplete?: () => void;
}

export function ShareModal({
  open,
  onOpenChange,
  mode,
  initialPayload = null,
  onImportComplete,
}: ShareModalProps) {
  const [password, setPassword] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [pasteLink, setPasteLink] = useState(initialPayload ? '' : '');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const payloadFromInput = initialPayload ?? (mode === 'import' ? parseShareUrl(pasteLink) : null);

  const handleGenerateLink = useCallback(async () => {
    setError(null);
    if (!password.trim()) {
      setError('Please set a password');
      return;
    }
    setWorking(true);
    try {
      const session = getSerializedSessionForShare();
      const encrypted = await encryptSharePayload(session, password);
      const url = buildShareUrl(encrypted);
      setShareLink(url);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setWorking(false);
    }
  }, [password]);

  const handleImport = useCallback(async () => {
    setError(null);
    const payload = payloadFromInput;
    if (!payload) {
      setError('Paste a share link above');
      return;
    }
    if (!password.trim()) {
      setError('Enter the password for this link');
      return;
    }
    setWorking(true);
    try {
      const data = await decryptSharePayload(payload, password);
      loadSharedSession(data as SerializedSession);
      onImportComplete?.();
      onOpenChange(false);
      setPassword('');
      setPasteLink('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong password or invalid link');
    } finally {
      setWorking(false);
    }
  }, [payloadFromInput, password, onOpenChange, onImportComplete]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setPassword('');
        setShareLink('');
        setPasteLink('');
        setError(null);
        setCopied(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const isImport = mode === 'import';
  const canSubmit = isImport
    ? !!payloadFromInput && !!password.trim()
    : !!password.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            {isImport ? 'Open shared document' : 'Share document'}
          </DialogTitle>
          <DialogDescription>
            {isImport
              ? 'Paste the share link and enter the password to load the document.'
              : 'Set a password and generate a link. Anyone with the link and password can open this document. Enclosure files are not included.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {isImport && !initialPayload && (
            <div className="space-y-2">
              <Label htmlFor="share-paste-link">Share link</Label>
              <Input
                id="share-paste-link"
                type="url"
                placeholder="Paste the share link here"
                value={pasteLink}
                onChange={(e) => setPasteLink(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          )}
          {isImport && initialPayload && (
            <p className="text-sm text-muted-foreground">
              Opening document from link. Enter the password below.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="share-password">
              {isImport ? 'Password' : 'Password for this link'}
            </Label>
            <Input
              id="share-password"
              type="password"
              placeholder={isImport ? 'Enter password' : 'Set a password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (isImport) handleImport();
                  else handleGenerateLink();
                }
              }}
              autoComplete={isImport ? 'current-password' : 'new-password'}
            />
          </div>

          {!isImport && shareLink && (
            <div className="space-y-2">
              <Label>Share link (copied to clipboard)</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareLink}
                  className="font-mono text-xs truncate"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareLink);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                  aria-label="Copy again"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {isImport ? (
            <Button
              onClick={handleImport}
              disabled={!canSubmit || working}
            >
              {working ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                'Open document'
              )}
            </Button>
          ) : (
            <Button
              onClick={handleGenerateLink}
              disabled={!canSubmit || working}
            >
              {working ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
              Link copied
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-2" />
                  Generate link
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
