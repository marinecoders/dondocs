import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewSharePasswordField } from "./NewSharePasswordField";
import { PackageShareReview } from "./PackageShareReview";
import { getExportDeploymentPolicy } from "@/config/classification";
import type { ActionPackage } from "@/lib/actionPackages";
import { preparePackageShare, encryptPreparedPackageShare, packageShareDelivery,
  type PreparedPackageShare, type EncryptedPackageShare } from "@/lib/actionPackageShare";
import { triggerDownload } from "@/lib/encoding";
import { newSharePasswordError } from "@/lib/shareCrypto";

type Props = { record: ActionPackage; revisionId: string; onClose(): void };

export default function PackageShareDialog(props: Props) {
  return <PackageShareDialogContent key={`${props.record.id}:${props.revisionId}`} {...props} />;
}

function PackageShareDialogContent({ record, revisionId, onClose }: Props) {
  const [prepared, setPrepared] = useState<PreparedPackageShare | null>(null);
  const [generated, setGenerated] = useState<EncryptedPackageShare | null>(null);
  const [password, setPassword] = useState("");
  const [expiration, setExpiration] = useState("none");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await preparePackageShare(record, revisionId, await getExportDeploymentPolicy(), controller.signal);
        if (current && alive.current) setPrepared(result);
      } catch (cause) { if (current && alive.current) setError(cause instanceof Error ? cause.message : "The package could not be prepared."); }
      finally { if (current && alive.current) setBusy(false); }
    })();
    return () => { current = false; alive.current = false; controller.abort(); };
  }, [record, revisionId]);
  function close() { alive.current = false; setPassword(""); onClose(); }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "The package could not be shared."); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="sm:max-w-xl max-h-[85dvh] flex flex-col" aria-busy={busy}>
      <DialogHeader>
        <DialogTitle>Share action package</DialogTitle>
        <DialogDescription>Send a password-encrypted copy of the selected revision. Send its password separately.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto space-y-4 pr-1">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {!prepared && busy && <p role="status">Preparing captured package content…</p>}
        {prepared && <PackageShareReview prepared={prepared} />}
        <p className="text-sm text-muted-foreground">Expiration is checked against the recipient’s device clock before opening. It cannot revoke opened copies or stop someone with the password extracting their contents.</p>
        <fieldset disabled={busy} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="package-share-expiration">Package expiration</Label>
            <select id="package-share-expiration" className="w-full rounded border bg-background p-2 text-sm" value={expiration}
              onChange={event => { setExpiration(event.target.value); setGenerated(null); }}>
              <option value="none">No expiration</option><option value="hour">1 hour after generation</option>
              <option value="day">24 hours after generation</option><option value="week">7 days after generation</option>
            </select>
          </div>
          {!generated && <NewSharePasswordField id="package-share-password" label="Package password"
            value={password} onChange={setPassword} disabled={busy} />}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved}
            onChange={event => { setApproved(event.target.checked); if (!event.target.checked) setGenerated(null); }} />
            I reviewed every included member, original file, privacy finding and classification marking for this encrypted package.
          </label>
          {!generated && <Button disabled={!prepared || !approved || !password.trim()} onClick={() => void run(async () => {
            if (!prepared) return;
            const passwordError = newSharePasswordError(password);
            if (passwordError) throw new Error(passwordError);
            const duration = ({ hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as Record<string, number>)[expiration];
            const encrypted = await encryptPreparedPackageShare(prepared, password, duration === undefined ? undefined : Date.now() + duration);
            if (!alive.current) return;
            setGenerated(encrypted); setPassword("");
          })}>Generate encrypted package</Button>}
          {generated && <div className="space-y-3 rounded border p-3 text-sm">
            {generated.expiresAt !== undefined && <p>Expires {new Date(generated.expiresAt).toLocaleString(undefined, { timeZoneName: "short" })}.</p>}
            {generated.url ? <>
              <Label htmlFor="package-share-link">Encrypted package link</Label>
              <Input id="package-share-link" value={generated.url} readOnly className="font-mono text-xs" />
              <Button variant="outline" onClick={() => void run(async () => {
                const delivery = await packageShareDelivery(generated);
                if (!alive.current || !delivery.url) return;
                await navigator.clipboard.writeText(delivery.url);
                if (alive.current) setNotice("Encrypted package link copied.");
              })}>Copy package link</Button>
            </> : <p>This package is too large for a reliable link. Send the encrypted file instead.</p>}
            <Button variant="outline" onClick={() => void run(async () => {
              const delivery = await packageShareDelivery(generated);
              if (!alive.current) return;
              triggerDownload(delivery.file, `action-package-${record.name.replace(/[^a-z0-9_-]/gi, "_")}.dondocs-package.encrypted.json`, "application/json");
              setNotice("Encrypted package file downloaded.");
            })}>Download encrypted package file</Button>
            <p>Open either form through Open from share link. Encrypted files can also be selected in Import editable package.</p>
          </div>}
        </fieldset>
      </div>
      <Button variant="outline" onClick={close}>Close sharing</Button>
    </DialogContent>
  </Dialog>;
}
