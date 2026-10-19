import { SessionPreview } from '@/components/SessionPreview';
/**
 * Share Modal
 *
 * Share: encrypt current document with password, copy link to clipboard.
 * Import: paste share link, enter password, decrypt and load document.
 */

import { useState, useCallback } from 'react';
import { Link2, Copy, Check, Loader2, AlertTriangle } from 'lucide-react';
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
import { getSerializedSessionForShare, loadSharedSession, type SerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { parseSharedSession } from '@/lib/sharedSession';
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
  const [snapshot] = useState(() => mode === 'share' ? getSerializedSessionForShare() : null);
  const [received, setReceived] = useState<SerializedSession | null>(null);
  const [password, setPassword] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [pasteLink, setPasteLink] = useState(initialPayload ? '' : '');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Non-null when a pre-share PII scan found something; the user confirms or backs out.
  const [piiFindings, setPiiFindings] = useState<PIIDetectionResult | null>(null);

  const payloadFromInput = initialPayload ?? (mode === 'import' ? parseShareUrl(pasteLink) : null);

  const copyLink = useCallback(async (url: string) => {
    setError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy the link. Select and copy the share link manually.');
    }
  }, []);

  // The actual encrypt → build → copy, run only once any PII has been
  // acknowledged. A share link leaves the device, so it goes through the same
  // PII conscience-check the PDF/DOCX exports do.
  const doGenerate = useCallback(async () => {
    setPiiFindings(null);
    setWorking(true);
    try {
      const session = snapshot!;
      const encrypted = await encryptSharePayload(session, password);
      const url = buildShareUrl(encrypted);
      setShareLink(url);
      // The link is generated and shown regardless — isolate the clipboard write so
      // a failure (insecure context / denied permission) only skips the "copied"
      // confirmation instead of reporting a false "Failed to generate link".
      await copyLink(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setWorking(false);
    }
  }, [password, snapshot, copyLink]);

  const handleGenerateLink = useCallback(() => {
    setError(null);
    if (!password.trim()) {
      setError('Please set a password');
      return;
    }
    // Scan before the document can leave the device; warn once, then let the
    // user decide (the payload is still password-encrypted either way).
    const session = snapshot!;
    const pii = detectPII(session.forms ? { formData: {}, paragraphs: [{ text: JSON.stringify(session.forms) }], copyTos: [], references: [] } : session);
    if (pii.found) {
      setPiiFindings(pii);
      return;
    }
    void doGenerate();
  }, [password, doGenerate, snapshot]);

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
      setReceived(parseSharedSession(data));
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong password or invalid link');
    } finally {
      setWorking(false);
    }
  }, [payloadFromInput, password]);

  const openReceived = () => {
    if (!received) return;
    useDocumentsStore.getState().syncCurrent();
    loadSharedSession(received);
    useDocumentsStore.getState().openLoadedAsNew();
    onImportComplete?.();
    onOpenChange(false);
  };

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (working) return;
      if (!next) {
        setPassword('');
        setShareLink('');
        setPasteLink('');
        setError(null);
        setCopied(false);
      }
      onOpenChange(next);
    },
    [onOpenChange, working]
  );

  const isImport = mode === 'import';
  const canSubmit = isImport
    ? !!payloadFromInput && !!password.trim()
    : !!password.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg w-[calc(100vw-2rem)] max-h-[85dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            {isImport ? 'Open shared document' : 'Share document'}
          </DialogTitle>
          <DialogDescription>
            {isImport
              ? 'Paste the share link and enter the password to load the document.'
              : 'Set a password and generate a link. Anyone with the link and password can open this document. The link is a snapshot; later edits are not shared.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4 pr-1">

        {!isImport && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <p className="font-medium">What the recipient receives</p>
            {snapshot && <SessionPreview session={snapshot} />}
            <p className="text-muted-foreground">Excluded: attached PDFs, basic-letter files, signature images, version history and other drafts. Send necessary files separately.</p>
          </div>
        )}
        {received && <div className="space-y-2 rounded-md border p-3"><SessionPreview session={received} /><p className="text-xs text-muted-foreground">Opens as a new document. Your current draft stays in Recents.</p></div>}
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer py-1">How sharing works</summary>
          <p className="mt-2">The link holds an encrypted copy made in your browser. Send the password separately. A shared link cannot be revoked, and changes to your draft do not update it.</p>
        </details>

        <div className="flex flex-col gap-4 py-2">
          {isImport && !received && !initialPayload && (
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
          {isImport && !received && initialPayload && (
            <p className="text-sm text-muted-foreground">
              Opening document from link. Enter the password below.
            </p>
          )}

          {!received && <div data-tour="share-password" className="space-y-2">
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
              disabled={working}
            />
          </div>}

          {!isImport && shareLink && (
            <div className="space-y-2">
              <Label htmlFor="generated-share-link">{copied ? 'Share link (copied to clipboard)' : 'Share link'}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="generated-share-link"
                  readOnly
                  value={shareLink}
                  className="font-mono text-xs truncate"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void copyLink(shareLink)}
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
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="font-medium text-warning">This document may contain PII/PHI</p>
                  <p className="mt-0.5 text-warning">
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

        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {isImport ? (
            <Button
              onClick={received ? openReceived : handleImport}
              disabled={(!received && !canSubmit) || working}
            >
              {working ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                received ? 'Open as new document' : 'Decrypt and review'
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
