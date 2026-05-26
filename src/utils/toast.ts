import type { Toast } from '../components/ui/Toast';

class ToastManager {
  private toasts: Toast[] = [];
  private listeners: Set<(toasts: Toast[]) => void> = new Set();
  private idCounter = 0;

  subscribe(listener: (toasts: Toast[]) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener([...this.toasts]));
  }

  show(message: string, type: Toast['type'] = 'success', duration?: number, persistent?: boolean) {
    const id = `toast-${++this.idCounter}-${Date.now()}`;
    const t: Toast = { id, message, type, duration, persistent };
    this.toasts.push(t);
    this.notify();
    return id;
  }

  update(id: string, message: string, type?: Toast['type']) {
    const t = this.toasts.find((t) => t.id === id);
    if (t) {
      t.message = message;
      if (type) t.type = type;
      this.notify();
    }
  }

  remove(id: string) {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
    this.notify();
  }

  getToasts() {
    return [...this.toasts];
  }
}

export const toastManager = new ToastManager();

export const toast = {
  success: (message: string, duration?: number) => toastManager.show(message, 'success', duration),
  error: (message: string, duration?: number) => toastManager.show(message, 'error', duration),
  info: (message: string, duration?: number) => toastManager.show(message, 'info', duration),
  persistent: (message: string, type: Toast['type'] = 'info') => toastManager.show(message, type, undefined, true),
  update: (id: string, message: string, type?: Toast['type']) => toastManager.update(id, message, type),
  remove: (id: string) => toastManager.remove(id),
};

