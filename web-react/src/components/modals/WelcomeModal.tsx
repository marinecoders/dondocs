import { useState, useEffect } from 'react';
import { Rocket, FileText, Shield, Zap, Users } from 'lucide-react';
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

  useEffect(() => {
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

  // Rotate tips
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setCurrentTip((prev) => (prev + 1) % TIPS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden" showCloseButton={false}>
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-8 text-white">
          <div className="flex items-center gap-3 mb-2">
            <Rocket className="h-8 w-8" />
            <DialogTitle className="text-2xl font-bold text-white">
              Welcome to libo-secured
            </DialogTitle>
          </div>
          <p className="text-white/90 text-sm">
            The professional naval correspondence generator for Marines, by Marines.
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

          {/* Rotating tip */}
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
            <p className="text-xs text-primary font-medium mb-1">Pro Tip</p>
            <p className="text-sm transition-opacity duration-300">{TIPS[currentTip]}</p>
            <div className="flex gap-1 mt-2">
              {TIPS.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1 w-4 rounded-full transition-colors ${
                    idx === currentTip ? 'bg-primary' : 'bg-primary/30'
                  }`}
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
