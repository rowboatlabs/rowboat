/**
 * Simple toast notification system
 */

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

let toasts: Toast[] = [];
const listeners: Set<() => void> = new Set();

/**
 * Show a toast notification
 */
export function toast(message: string, type: ToastType = 'info'): void {
  const id = `${Date.now()}-${Math.random()}`;
  toasts.push({ id, message, type });
  notifyListeners();

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
    notifyListeners();
  }, 3000);
}

/**
 * Get current toasts
 */
export function getToasts(): Toast[] {
  return [...toasts];
}

/**
 * Subscribe to toast changes
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  listeners.forEach(listener => listener());
}

/**
 * Remove a toast by ID
 */
export function removeToast(id: string): void {
  toasts = toasts.filter(t => t.id !== id);
  notifyListeners();
}

