import { AlertTriangle, Shield, X, FileWarning, Download } from 'lucide-react';
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

const severityColors = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
};

const typeIcons: Record<PIIType, string> = {
  SSN: 'ID',
  EDIPI: 'DoD',
  DOB: 'DOB',
  PHONE: 'TEL',
  MEDICAL_KEYWORD: 'PHI',
  EMAIL_ADDRESS: '@',
};

function FindingItem({ finding }: { finding: PIIFinding }) {
  const severity = getPIITypeSeverity(finding.type);

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
          {finding.type !== 'MEDICAL_KEYWORD' && (
            <code className="block mt-1 text-sm font-mono bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded">
              {finding.value}
            </code>
          )}
          {finding.context && (
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
  const { piiWarningOpen, setPiiWarningOpen } = useUIStore();

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
        {/* Warning Header */}
        <div className={`px-6 py-5 ${totalHighSeverity > 0 ? 'bg-gradient-to-r from-red-600 to-orange-600' : 'bg-gradient-to-r from-amber-600 to-orange-500'} text-white`}>
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
              <p className="text-white/80 text-sm mt-1">
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
