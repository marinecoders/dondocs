import { documentCapabilities } from '@/lib/documentCapabilities';
import { SessionPreview } from '@/components/SessionPreview';
/**
 * Share Modal
 *
 * Share: encrypt current document with password, copy link to clipboard.
 * Import: paste share link, enter password, decrypt and load document.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link2, Copy, Check, Loader2, AlertTriangle, Download } from 'lucide-react';
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
  MAX_SHARE_URL_LENGTH,
  MAX_ENCRYPTED_SHARE_LENGTH,
} from '@/lib/shareCrypto';
import { getSerializedSessionForShare, useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { openSessionAsNew, captureDocumentTarget, captureDocumentScope, isCurrentDocumentScope, hasPendingReviewWrites, flushPendingReviewWrites } from '@/stores/documentsStore';
import { parseSharedSession, createSharedPayload, validateShareExpiration } from '@/lib/sharedSession';
import { detectSharedSessionPII, getPIITypeLabel, type PIIDetectionResult } from '@/services/pii/detector';
import { buildAssetSharePayload, hasShareAssets, isAssetShare, parseSharedDocument, assetShareReviewSession, assertConfiguredFormSharePolicy } from '@/lib/assetShare';
import { openSharedDocument } from '@/lib/sharedDocumentActions';
import { triggerDownload } from '@/lib/encoding';
import { getExportDeploymentPolicy } from '@/config/classification';
import { captureChangeReport, prepareChangeReport } from '@/lib/changeReport';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { z } from 'zod';

const encryptedFileSchema = z.object({ kind: z.literal('dondocs-encrypted-share'), version: z.literal(1), payload: z.string().min(1).max(MAX_ENCRYPTED_SHARE_LENGTH) }).strict();

export type ShareModalMode = 'share' | 'import';

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ShareModalMode;
  /** When opening from URL hash, pass the extracted payload so user only enters password */
  initialPayload?: string | null;
  onImportComplete?: () => void;
}

export function ShareModal(props: ShareModalProps) {
  return props.open ? <ShareModalContent key={`${props.mode}:${props.initialPayload ?? ''}`} {...props} /> : null;
}

function ShareModalContent({
  open,
  onOpenChange,
  mode,
  initialPayload = null,
  onImportComplete,
}: ShareModalProps) {
  const [ownerScope] = useState(() => mode === 'share' ? captureDocumentScope() : null);
  const reviewOwnerId = ownerScope?.documentId;
  const [capture, setCapture] = useState(() => {
    if (mode !== 'share') return { snapshot: null as SerializedSession | null, full: null as DocumentSnapshot | null, error: null as string | null };
    try { return { snapshot: getSerializedSessionForShare(), full: structuredClone(useDocumentStore.getState().getSnapshot()), error: null as string | null }; }
    catch (cause) { return { snapshot: null, full: null, error: cause instanceof Error ? cause.message : 'This draft could not be prepared for sharing. Save it and try again.' }; }
  });
  const snapshot = capture.snapshot;
  const [received, setReceived] = useState<{ session: SerializedSession; payload: object } | null>(null);
  const [expiration, setExpiration] = useState('none');
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [encryptedFile, setEncryptedFile] = useState('');
  const [importedFile, setImportedFile] = useState<{ name: string; payload: string } | null>(null);
  const [pasteLink, setPasteLink] = useState(initialPayload ? '' : '');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  // Non-null when a pre-share PII scan found something; the user confirms or backs out.
  const [piiFindings, setPiiFindings] = useState<PIIDetectionResult | null>(null);

  const payloadFromInput = initialPayload ?? importedFile?.payload ?? (mode === 'import' ? parseShareUrl(pasteLink) : null);

  const clearCopyTimer = useCallback(() => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = null;
  }, []);
  useEffect(() => clearCopyTimer, [clearCopyTimer]);

  const clearGeneratedLink = useCallback(() => {
    clearCopyTimer();
    setShareLink('');
    setEncryptedFile('');
    setGeneratedExpiresAt(null);
    setCopied(false);
    setPiiFindings(null);
    setError(null);
  }, [clearCopyTimer]);
  const changePassword = useCallback((value: string) => {
    setPassword(value);
    clearGeneratedLink();
  }, [clearGeneratedLink]);

  const copyLink = useCallback(async (url: string) => {
    clearCopyTimer();
    setError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(url);
      if (!alive.current) return;
      setCopied(true);
      copyTimer.current = setTimeout(() => { copyTimer.current = null; setCopied(false); }, 2500);
    } catch {
      if (alive.current) setError('Could not copy the link. Select and copy the share link manually.');
    }
  }, [clearCopyTimer]);

  const handleCopyAgain = useCallback(async () => {
    if (working || !shareLink) return;
    setWorking(true);
    try {
      if (generatedExpiresAt !== null) validateShareExpiration(generatedExpiresAt);
      await copyLink(shareLink);
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not copy the link.'); }
    finally { setWorking(false); }
  }, [working, shareLink, copyLink, generatedExpiresAt]);

  const canShareSnapshot = useCallback(() => {
    if (!snapshot) { setError('This draft is not ready for sharing. Retry preparing it after Save finishes.');return false; }
    const capability = documentCapabilities(snapshot, { operation: 'share', target: 'link' });
    switch (capability.status) {
      case 'supported': case 'partial': return true;
      default: setError(capability.message);return false;
    }
  }, [snapshot]);

  // The actual encrypt → build → copy, run only once any PII has been
  // acknowledged. A share link leaves the device, so it goes through the same
  // PII conscience-check the PDF/DOCX exports do.
  const doGenerate = useCallback(async () => {
    if (working || !canShareSnapshot()) return;
    setPiiFindings(null);
    setWorking(true);
    try {
      if (hasPendingReviewWrites(reviewOwnerId)) await flushPendingReviewWrites(reviewOwnerId);
      if (!alive.current) return;
      const session = snapshot!;
      const duration = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[expiration];
      const expiresAt = duration === undefined ? null : Date.now() + duration;
      let payload: object;
      if (capture.full && hasShareAssets(capture.full)) {
        payload = await buildAssetSharePayload(capture.full, session.timestamp, expiresAt ?? undefined);
        const policy = await getExportDeploymentPolicy(undefined, true);
        const complete = assetShareReviewSession(capture.full, session.timestamp);
        assertConfiguredFormSharePolicy(complete, policy);
        const empty = { ...complete, genericForm: undefined, forms: undefined, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, reviewComments: undefined };
        try { prepareChangeReport(captureChangeReport({ label: 'Empty', title: '', session: empty }, { label: 'Shared document', title: '', session: complete }, new Date().toISOString()), policy); }
        catch (cause) { throw new Error(cause instanceof Error ? cause.message.replace(/^This report/, 'This shared document') : 'This shared document could not be reviewed.', { cause }); }
      } else payload = expiresAt === null ? createSharedPayload(session) : createSharedPayload(session, expiresAt);
      const encrypted = await encryptSharePayload(payload, password);
      if (expiresAt !== null) validateShareExpiration(expiresAt);
      const url = buildShareUrl(encrypted);
      if (!alive.current) return;
      setEncryptedFile(encrypted);
      setGeneratedExpiresAt(expiresAt);
      if (url.length > MAX_SHARE_URL_LENGTH) { setShareLink('');return; }
      setShareLink(url);
      // The link is generated and shown regardless — isolate the clipboard write so
      // a failure (insecure context / denied permission) only skips the "copied"
      // confirmation instead of reporting a false "Failed to generate link".
      await copyLink(url);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      if (alive.current) setWorking(false);
    }
  }, [password, snapshot, capture.full, copyLink, working, canShareSnapshot, expiration, reviewOwnerId]);

  const handleGenerateLink = useCallback(() => {
    if (working) return;
    setError(null);
    setPiiFindings(null);
    if (!password.trim()) {
      setError('Please set a password');
      return;
    }
    if (!canShareSnapshot()) return;
    // Scan before the document can leave the device; warn once, then let the
    // user decide (the payload is still password-encrypted either way).
    let pii: PIIDetectionResult;
    try {
      pii = detectSharedSessionPII(capture.full ? assetShareReviewSession(capture.full, snapshot!.timestamp) : snapshot!);
    } catch {
      setError('Could not inspect this draft. Close sharing and review the document before trying again.');
      return;
    }
    if (pii.found) {
      setPiiFindings(pii);
      return;
    }
    void doGenerate();
  }, [password, doGenerate, snapshot, capture.full, working, canShareSnapshot]);

  const handleImport = useCallback(async () => {
    if (working) return;
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
      const reviewed = await parseSharedDocument(data);
      if (!alive.current) return;
      setReceived({ session: reviewed.session, payload: data });
      setPassword('');
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Wrong password or invalid link');
    } finally {
      if (alive.current) setWorking(false);
    }
  }, [payloadFromInput, password, working]);

  const openReceived = async () => {
    if (!received) return;
    // Password work and the review dialog may cross the deadline. Check again
    // immediately before handing anything to the document store.
    setWorking(true);setError(null);
    try {
      const outcome = isAssetShare(received.payload)
        ? await openSharedDocument(received.payload, captureDocumentTarget(), () => alive.current)
        : openSessionAsNew(parseSharedSession(received.payload));
      if (!alive.current) return;
      if (outcome !== 'applied') { setError('The active document changed. Your newer work has not been replaced; reopen the shared copy from Recents if it was saved.');return; }
      onImportComplete?.();onOpenChange(false);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'Could not open this document. Your current draft has not changed.'); }
    finally { if (alive.current) setWorking(false); }
  };

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (working) return;
      if (!next) {
        clearCopyTimer();
        setPassword('');
        setShareLink('');
        setEncryptedFile('');setImportedFile(null);
        setPasteLink('');
        setError(null);
        setCopied(false);
        setReceived(null);
        setGeneratedExpiresAt(null);
        setExpiration('none');
      }
      onOpenChange(next);
    },
    [onOpenChange, working, clearCopyTimer]
  );

  const isImport = mode === 'import';
  const canSubmit = isImport
    ? !!payloadFromInput && !!password.trim()
    : !!snapshot && !!password.trim();

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
              ? 'Paste a share link or choose an encrypted share file, then enter its password.'
              : 'Set a password and generate a link or encrypted file. Anyone with the copy and password can open this snapshot; later edits are not shared.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4 pr-1">

        {!isImport && capture.error && <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{capture.error}</p>
          <Button type="button" variant="outline" disabled={working} onClick={() => void (async () => {
            setWorking(true);setError(null);
            try {
              if (!ownerScope || !isCurrentDocumentScope(ownerScope)) throw new Error('The active draft changed. Close Share and reopen it for the document you want to send.');
              if (hasPendingReviewWrites(reviewOwnerId)) await flushPendingReviewWrites(reviewOwnerId);
              if (!isCurrentDocumentScope(ownerScope)) throw new Error('The active draft changed. Close Share and reopen it for the document you want to send.');
              setCapture({ snapshot: getSerializedSessionForShare(), full: structuredClone(useDocumentStore.getState().getSnapshot()), error: null });
            } catch (cause) { setCapture({ snapshot: null, full: null, error: cause instanceof Error ? cause.message : 'This draft could not be prepared. Retry Save first.' }); }
            finally { setWorking(false); }
          })()}>Retry preparing document</Button>
        </div>}
        {!isImport && hasPendingReviewWrites(reviewOwnerId) && <p role="status" className="text-sm">Review feedback is still saving. Generating a link will wait for Save to finish.</p>}

        {!isImport && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <p className="font-medium">What the recipient receives</p>
            {snapshot && <SessionPreview session={snapshot} />}
            <p className="text-muted-foreground">Includes required native attached PDFs, basic-letter files, PNG signatures and PNG/JPEG figures. Large copies use an encrypted file. Version history and other drafts are excluded. Configured forms still require their selected PDF template.</p>
          </div>
        )}
        {received && <div className="space-y-2 rounded-md border p-3"><SessionPreview session={received.session} />{isAssetShare(received.payload) && <p className="text-sm">The included attachments passed their size, type and checksum checks. Inspect their contents before using or forwarding them.</p>}<p className="text-xs text-muted-foreground">Opens as a new document. Your current draft stays in Recents.</p></div>}
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer py-1">How sharing works</summary>
          <p className="mt-2">The link holds an encrypted copy made in your browser. Send the password separately. A shared link cannot be revoked, and changes to your draft do not update it.</p>
          <p className="mt-2">Optional expiration blocks opening in DonDocs using the recipient’s device clock. It cannot remove copies already opened or prevent someone with the password from extracting the contents.</p>
        </details>

        <div className="flex flex-col gap-4 py-2">
          {!isImport && <div className="space-y-2">
            <Label htmlFor="share-expiration">Link expiration</Label>
            <select id="share-expiration" value={expiration} disabled={working}
              onChange={event => { setExpiration(event.target.value); clearGeneratedLink(); }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="none">No expiration</option>
              <option value="hour">1 hour after generation</option>
              <option value="day">24 hours after generation</option>
              <option value="week">7 days after generation</option>
            </select>
            <p className="text-xs text-muted-foreground">Checked on the recipient’s device before opening. Already opened copies remain available.</p>
          </div>}
          {isImport && !received && !initialPayload && (
            <div className="space-y-2">
              <Label htmlFor="share-paste-link">Share link</Label>
              <Input
                id="share-paste-link"
                type="url"
                placeholder="Paste the share link here"
                value={pasteLink}
                disabled={working}
              onChange={(e) => { setPasteLink(e.target.value);setImportedFile(null);setReceived(null);setError(null); }}
                className="font-mono text-sm"
              />
            </div>
          )}
          {isImport && !received && !initialPayload && <div className="space-y-2">
            <Label htmlFor="encrypted-share-file">Encrypted share file</Label>
            <Input id="encrypted-share-file" type="file" accept=".json,application/json" disabled={working} onChange={event => {
              const file = event.target.files?.[0];event.target.value = '';
              setImportedFile(null);setReceived(null);setError(null);
              if (!file || working) return;
              setWorking(true);
              void (async () => {
                try {
                  if (file.size > MAX_ENCRYPTED_SHARE_LENGTH + 1024) throw new Error('This encrypted share file exceeds the transfer limit.');
                  const parsed = encryptedFileSchema.safeParse(JSON.parse(await file.text()));
                  if (!parsed.success) throw new Error('Choose an encrypted share file downloaded from DonDocs.');
                  if (alive.current) { setImportedFile({ name: file.name, payload: parsed.data.payload });setPasteLink(''); }
                } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Could not read this encrypted share file.'); }
                finally { if (alive.current) setWorking(false); }
              })();
            }} />
            {importedFile && <p className="text-sm break-words">Selected: {importedFile.name}</p>}
          </div>}
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
              onChange={(e) => changePassword(e.target.value)}
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
              {generatedExpiresAt !== null && <p className="text-xs text-muted-foreground">Expires {new Date(generatedExpiresAt).toLocaleString(undefined, { timeZoneName: 'short' })}. Requires an updated DonDocs reader.</p>}
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
                  onClick={() => void handleCopyAgain()}
                  disabled={working}
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
          {!isImport && encryptedFile && <div className="space-y-2 rounded-md border p-3 text-sm">
            {!shareLink && <p>This copy is too large for a reliable link. Send the encrypted file and share its password separately.</p>}
            {generatedExpiresAt !== null && !shareLink && <p>Expires {new Date(generatedExpiresAt).toLocaleString(undefined, { timeZoneName: 'short' })}. Requires an updated DonDocs reader.</p>}
            <Button variant="outline" disabled={working} onClick={() => {
              try {
                if (generatedExpiresAt !== null) validateShareExpiration(generatedExpiresAt);
                triggerDownload(new TextEncoder().encode(JSON.stringify({ kind: 'dondocs-encrypted-share', version: 1, payload: encryptedFile })), 'dondocs-encrypted-share.json', 'application/json');
              } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download the encrypted share file.'); }
            }}><Download className="mr-2 h-4 w-4" />Download encrypted share file</Button>
            <p className="text-muted-foreground">Open this file through Open from share link → Encrypted share file. The file is password-encrypted and includes the same captured content as the link.</p>
          </div>}

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
                  <p className="mt-1 text-muted-foreground">Checks text and form values. Images and attached PDFs are not inspected.</p>
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
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={working}>
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
                  Working…
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
