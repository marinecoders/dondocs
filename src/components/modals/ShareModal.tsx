/**
 * Share Modal
 *
 * Share: encrypt current document with password, copy link to clipboard.
 * Import: paste share link, enter password, decrypt and load document.
 */

import { useState, useCallback } from 'react';
import { Link2, Copy, Check, Loader2, ShieldAlert, AlertTriangle } from 'lucide-react';
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
import { getSerializedSessionForShare, loadSharedSession, useDocumentStore } from '@/stores/documentStore';
import type { SerializedSession } from '@/stores/documentStore';
import { detectPII, getPIITypeLabel, type PIIDetectionResult } from '@/services/pii/detector';

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
  // Non-null when a pre-share PII scan found something; the user confirms or backs out.
  const [piiFindings, setPiiFindings] = useState<PIIDetectionResult | null>(null);

  const payloadFromInput = initialPayload ?? (mode === 'import' ? parseShareUrl(pasteLink) : null);

  // The actual encrypt → build → copy, run only once any PII has been
  // acknowledged. A share link leaves the device, so it goes through the same
  // PII conscience-check the PDF/DOCX exports do.
  const doGenerate = useCallback(async () => {
    setPiiFindings(null);
    setWorking(true);
    try {
      const session = getSerializedSessionForShare();
      const encrypted = await encryptSharePayload(session, password);
      const url = buildShareUrl(encrypted);
      setShareLink(url);
      // The link is generated and shown regardless — isolate the clipboard write so
      // a failure (insecure context / denied permission) only skips the "copied"
      // confirmation instead of reporting a false "Failed to generate link".
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* clipboard unavailable — the visible link is still usable */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setWorking(false);
    }
  }, [password]);

  const handleGenerateLink = useCallback(() => {
    setError(null);
    if (!password.trim()) {
      setError('Please set a password');
      return;
    }
    // Scan before the document can leave the device; warn once, then let the
    // user decide (the payload is still password-encrypted either way).
    const pii = detectPII(useDocumentStore.getState());
    if (pii.found) {
      setPiiFindings(pii);
      return;
    }
    void doGenerate();
  }, [password, doGenerate]);

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

        <div
          className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
          role="status"
          aria-live="polite"
        >
          <ShieldAlert className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-medium mb-0.5">How encryption works</p>
            <p className="text-muted-foreground dark:text-amber-200/90">
              Encryption is done in your browser only. Your password is never sent to any server.
              The link contains data encrypted with AES-GCM using a key derived from your password (PBKDF2).
              Share the link and the password separately; anyone with both can decrypt and open the document.
            </p>
          </div>
        </div>

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

          <div data-tour="share-password" className="space-y-2">
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
              <Label>{copied ? 'Share link (copied to clipboard)' : 'Share link'}</Label>
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
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
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

          {!isImport && piiFindings && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <p className="font-medium text-amber-800 dark:text-amber-300">This document may contain PII/PHI</p>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-400/90">
                    Found {piiFindings.findings.length} potential item{piiFindings.findings.length === 1 ? '' : 's'} (
                    {[...new Set(piiFindings.findings.map((f) => getPIITypeLabel(f.type)))].join(', ')}). The link is
                    password-encrypted, but it still leaves your device — share it only if you mean to.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => void doGenerate()} disabled={working}>
                      Share anyway
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPiiFindings(null)}>
                      Review first
                    </Button>
                  </div>
                </div>
              </div>
            </div>
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
              data-tour="share-generate"
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
