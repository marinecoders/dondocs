import { useState } from 'react';
import { AlertTriangle, Shield, X, FileWarning, Download, Eye, EyeOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import type { PIIDetectionResult, PIIFinding, PIIType } from '@/services/pii/detector';
import { getPIITypeLabel, getPIITypeSeverity } from '@/services/pii/detector';

interface PIIWarningModalProps {
  detectionResult: PIIDetectionResult | null;
  onCancel: () => void;
  onProceed: () => void;
}

// Severity tints driven by theme tokens (not hardcoded palette hues), so all
// schemes restain from one source: high → destructive, medium → warning,
// low → primary (info).
const severityColors = {
  high: 'bg-destructive/10 text-destructive border-destructive/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  low: 'bg-primary/10 text-primary border-primary/30',
};

const typeIcons: Record<PIIType, string> = {
  SSN: 'ID',
  EDIPI: 'DoD',
  DOB: 'DOB',
  PHONE: 'TEL',
  MEDICAL_KEYWORD: 'PHI',
  EMAIL_ADDRESS: '@',
};

// Mask a detected value down to its last 4 characters so a privacy warning
// doesn't itself print the SSN/DoD ID in cleartext. Revealed on demand per row.
function maskPII(type: PIIType, value: string): string {
  const digits = value.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  switch (type) {
    case 'SSN':
      return `•••-••-${last4}`;
    case 'EDIPI':
      return `••••••${last4}`;
    case 'PHONE':
      return `•••-•••-${last4}`;
    case 'DOB':
      return '••/••/••••';
    case 'EMAIL_ADDRESS': {
      const [user, domain] = value.split('@');
      return user && domain ? `${user[0]}•••@${domain}` : '•••';
    }
    default:
      return value;
  }
}

function FindingItem({ finding }: { finding: PIIFinding }) {
  const severity = getPIITypeSeverity(finding.type);
  const [revealed, setRevealed] = useState(false);
  const hasValue = finding.type !== 'MEDICAL_KEYWORD';

  return (
    <div className={`p-3 rounded-lg border ${severityColors[severity]}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-current/10 flex items-center justify-center text-xs font-bold">
          {typeIcons[finding.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{getPIITypeLabel(finding.type)}</span>
            <Badge variant="outline" className="text-xs">
              {finding.field}
            </Badge>
          </div>
          {hasValue && (
            <div className="mt-1 flex items-center gap-1.5">
              <code className="text-sm font-mono bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded">
                {revealed ? finding.value : maskPII(finding.type, finding.value)}
              </code>
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? 'Hide value' : 'Reveal value'}
                aria-pressed={revealed}
                className="rounded p-1 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
          {/* The context window can quote the value verbatim, so only surface it
              once the user has chosen to reveal (medical keywords carry no value
              and keep their context as the only clue). */}
          {finding.context && (!hasValue || revealed) && (
            <p className="mt-1 text-xs opacity-75 truncate">
              {finding.context}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBadge({ count, label, severity }: { count: number; label: string; severity: 'high' | 'medium' | 'low' }) {
  if (count === 0) return null;

  return (
    <div className={`px-3 py-2 rounded-lg border ${severityColors[severity]} text-center`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

export function PIIWarningModal({ detectionResult, onCancel, onProceed }: PIIWarningModalProps) {
  // Individual selectors — modal only re-renders on its own flag changing.
  const piiWarningOpen = useUIStore((s) => s.piiWarningOpen);
  const setPiiWarningOpen = useUIStore((s) => s.setPiiWarningOpen);

  if (!detectionResult || !detectionResult.found) {
    return null;
  }

  const { summary, findings } = detectionResult;

  // Group findings by type
  const groupedFindings = findings.reduce((acc, finding) => {
    if (!acc[finding.type]) {
      acc[finding.type] = [];
    }
    acc[finding.type].push(finding);
    return acc;
  }, {} as Record<PIIType, PIIFinding[]>);

  const handleClose = () => {
    setPiiWarningOpen(false);
    onCancel();
  };

  const handleProceed = () => {
    setPiiWarningOpen(false);
    onProceed();
  };

  const totalHighSeverity = summary.ssn + summary.edipi;

  return (
    <Dialog open={piiWarningOpen} onOpenChange={(open) => {
      if (!open) handleClose();
    }}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden" showCloseButton={false}>
        {/* Warning Header — flat token color (no decorative gradient): the
            destructive/warning tokens restain per scheme and carry AA-contrast
            foregrounds, so red/amber palette drift is gone. */}
        <div className={`px-6 py-5 ${totalHighSeverity > 0 ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground'}`}>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl">
              {totalHighSeverity > 0 ? (
                <AlertTriangle className="h-8 w-8" />
              ) : (
                <Shield className="h-8 w-8" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {totalHighSeverity > 0 ? 'Sensitive Data Detected!' : 'Potential PII/PHI Detected'}
              </h2>
              <p className="opacity-80 text-sm mt-1">
                {findings.length} potential issue{findings.length !== 1 ? 's' : ''} found in your document
              </p>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="px-6 py-4 bg-muted/30 border-b">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <SummaryBadge count={summary.ssn} label="SSN" severity="high" />
            <SummaryBadge count={summary.edipi} label="EDIPI" severity="high" />
            <SummaryBadge count={summary.dob} label="DOB" severity="medium" />
            <SummaryBadge count={summary.phone} label="Phone" severity="low" />
            <SummaryBadge count={summary.medicalKeywords} label="Medical" severity="medium" />
            <SummaryBadge count={summary.emailAddresses} label="Email" severity="low" />
          </div>
        </div>

        {/* Findings List */}
        <ScrollArea className="h-[280px]">
          <div className="p-6 space-y-4">
            {Object.entries(groupedFindings).map(([type, typeFindings]) => (
              <div key={type}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <FileWarning className="h-4 w-4" />
                  {getPIITypeLabel(type as PIIType)} ({typeFindings.length})
                </h3>
                <div className="space-y-2">
                  {typeFindings.slice(0, 5).map((finding, index) => (
                    <FindingItem key={`${finding.field}-${index}`} finding={finding} />
                  ))}
                  {typeFindings.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      ...and {typeFindings.length - 5} more {getPIITypeLabel(type as PIIType).toLowerCase()} instances
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Warning Message */}
        <div className="px-6 py-3 bg-muted/50 border-t text-sm text-muted-foreground">
          <strong>Warning:</strong> Downloading documents containing PII/PHI may violate privacy regulations.
          Review your document carefully before proceeding.
        </div>

        {/* Actions */}
        <DialogFooter className="px-6 py-4 border-t gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleClose} className="gap-2">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button
            variant={totalHighSeverity > 0 ? 'destructive' : 'default'}
            onClick={handleProceed}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
