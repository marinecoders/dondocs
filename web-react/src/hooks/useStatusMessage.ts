import { useState, useCallback, useRef, useEffect } from 'react';
import { TIMING } from '@/lib/constants';

type MessageType = 'success' | 'error' | 'info' | 'warning';

interface StatusMessage {
  text: string;
  type: MessageType;
}

interface UseStatusMessageOptions {
  /** Duration to show the message in ms (default: 2000) */
  duration?: number;
  /** Clear previous message immediately when showing new one */
  clearPrevious?: boolean;
}

/**
 * Hook for managing transient status messages
 *
 * Usage:
 * ```tsx
 * const { message, showMessage, clearMessage } = useStatusMessage();
 *
 * // Show a message
 * showMessage('Saved!', 'success');
 *
 * // Render the message
 * {message && <span className={message.type}>{message.text}</span>}
 * ```
 */
export function useStatusMessage(options: UseStatusMessageOptions = {}) {
  const { duration = TIMING.STATUS_MESSAGE_DURATION, clearPrevious = true } = options;

  const [message, setMessage] = useState<StatusMessage | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any existing timeout
  const clearTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Clear the message
  const clearMessage = useCallback(() => {
    clearTimeout();
    setMessage(null);
  }, [clearTimeout]);

  // Show a message
  const showMessage = useCallback(
    (text: string, type: MessageType = 'info', customDuration?: number) => {
      if (clearPrevious) {
        clearTimeout();
      }

      setMessage({ text, type });

      const messageDuration = customDuration ?? duration;
      if (messageDuration > 0) {
        timeoutRef.current = window.setTimeout(() => {
          setMessage(null);
        }, messageDuration);
      }
    },
    [duration, clearPrevious, clearTimeout]
  );

  // Convenience methods
  const showSuccess = useCallback(
    (text: string, customDuration?: number) => showMessage(text, 'success', customDuration),
    [showMessage]
  );

  const showError = useCallback(
    (text: string, customDuration?: number) => showMessage(text, 'error', customDuration),
    [showMessage]
  );

  const showInfo = useCallback(
    (text: string, customDuration?: number) => showMessage(text, 'info', customDuration),
    [showMessage]
  );

  const showWarning = useCallback(
    (text: string, customDuration?: number) => showMessage(text, 'warning', customDuration),
    [showMessage]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeout();
  }, [clearTimeout]);

  return {
    message,
    showMessage,
    clearMessage,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };
}

/**
 * Get CSS classes for a message type
 */
export function getMessageClasses(type: MessageType): string {
  const baseClasses = 'text-sm font-medium px-2 py-1 rounded';

  switch (type) {
    case 'success':
      return `${baseClasses} text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30`;
    case 'error':
      return `${baseClasses} text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30`;
    case 'warning':
      return `${baseClasses} text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30`;
    case 'info':
    default:
      return `${baseClasses} text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30`;
  }
}

export default useStatusMessage;
