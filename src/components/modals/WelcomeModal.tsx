import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Shield, Zap, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDeviceInfo } from '@/utils/device';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const WELCOME_STORAGE_KEY = 'libo-secured-welcome-shown';
const WELCOME_VERSION = '1.0'; // Increment to show welcome again after major updates

interface Feature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: <FileText className="h-5 w-5 text-blue-500" />,
    title: '18 Document Types',
    description: 'Naval letters, memoranda, endorsements, and more - all SECNAV M-5216.5 compliant.',
  },
  {
    icon: <Shield className="h-5 w-5 text-green-500" />,
    title: 'NIST 800-171 Compliant',
    description: 'All processing happens locally in your browser. No data is sent to any server.',
  },
  {
    icon: <Zap className="h-5 w-5 text-yellow-500" />,
    title: 'LaTeX-Quality Output',
    description: 'Professional typesetting using SwiftLaTeX WebAssembly for pixel-perfect PDFs.',
  },
  {
    icon: <Users className="h-5 w-5 text-purple-500" />,
    title: 'Profiles & Templates',
    description: 'Save your unit info as profiles and use pre-built templates for common documents.',
  },
];

const TIPS = [
  'Use Ctrl+S to save your progress, Ctrl+Z to undo, Ctrl+Y to redo',
  'Click the NIST badge in the header to learn about our security features',
  'Use {{PLACEHOLDER}} syntax in your document for batch generation',
  'Drag and drop PDF enclosures to include them in your final document',
  'Your signature image can be saved with your profile for quick reuse',
];

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [currentTip, setCurrentTip] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const resumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Don't show welcome modal on incompatible browsers - they get the browser notice instead
    const device = getDeviceInfo();
    if (device.isInAppBrowser) {
      console.log('[WelcomeModal] Skipping - in-app browser detected');
      return;
    }

    const stored = localStorage.getItem(WELCOME_STORAGE_KEY);
    if (!stored || stored !== WELCOME_VERSION) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(WELCOME_STORAGE_KEY, WELCOME_VERSION);
    }
    setOpen(false);
  };

  // Navigate to previous tip
  const goToPrev = useCallback(() => {
    setCurrentTip((prev) => (prev - 1 + TIPS.length) % TIPS.length);
    setIsPaused(true);
    // Clear any existing resume timeout
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }
    // Resume auto-scroll after 4 seconds of inactivity
    resumeTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
    }, 4000);
  }, []);

  // Navigate to next tip
  const goToNext = useCallback(() => {
    setCurrentTip((prev) => (prev + 1) % TIPS.length);
    setIsPaused(true);
    // Clear any existing resume timeout
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }
    // Resume auto-scroll after 4 seconds of inactivity
    resumeTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
    }, 4000);
  }, []);

  // Click on indicator dot
  const goToTip = useCallback((index: number) => {
    setCurrentTip(index);
    setIsPaused(true);
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }
    resumeTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
    }, 4000);
  }, []);

  // Auto-rotate tips when not paused
  useEffect(() => {
    if (!open || isPaused) {
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
        autoScrollIntervalRef.current = null;
      }
      return;
    }
    autoScrollIntervalRef.current = setInterval(() => {
      setCurrentTip((prev) => (prev + 1) % TIPS.length);
    }, 5000);
    return () => {
      if (autoScrollIntervalRef.current) {
        clearInterval(autoScrollIntervalRef.current);
      }
    };
  }, [open, isPaused]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
      if (autoScrollIntervalRef.current) clearInterval(autoScrollIntervalRef.current);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden" showCloseButton={false}>
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8 text-white">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="h-8 w-8" />
            <DialogTitle className="text-2xl font-bold text-white">
              Naval Correspondence Generator
            </DialogTitle>
          </div>
          <p className="text-white/90 text-sm">
            Professional document generation for Marines, by Marines. SECNAV M-5216.5 compliant.
          </p>
        </div>

        {/* Features */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map((feature, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <div className="shrink-0 mt-0.5">{feature.icon}</div>
                <div>
                  <h4 className="font-medium text-sm">{feature.title}</h4>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Rotating tip with navigation */}
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-primary font-medium">Pro Tip</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrev}
                  className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                  title="Previous tip"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-muted-foreground min-w-[3ch] text-center">
                  {currentTip + 1}/{TIPS.length}
                </span>
                <button
                  onClick={goToNext}
                  className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                  title="Next tip"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-sm transition-opacity duration-300 min-h-[2.5rem]">{TIPS[currentTip]}</p>
            <div className="flex gap-1 mt-2">
              {TIPS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => goToTip(idx)}
                  className={`h-1.5 w-4 rounded-full transition-colors ${
                    idx === currentTip ? 'bg-primary' : 'bg-primary/30 hover:bg-primary/50'
                  }`}
                  title={`Tip ${idx + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <div className="flex items-center gap-2 flex-1">
            <Checkbox
              id="dontShow"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(!!checked)}
            />
            <Label htmlFor="dontShow" className="text-sm font-normal cursor-pointer">
              Don't show this again
            </Label>
          </div>
          <Button onClick={handleClose}>Get Started</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export helper to reset welcome modal (for settings/help menu)
export function resetWelcomeModal() {
  localStorage.removeItem(WELCOME_STORAGE_KEY);
}
