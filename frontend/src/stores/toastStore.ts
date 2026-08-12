import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  show: (message: string, kind?: ToastKind, duration?: number) => void;
  dismiss: (id: string) => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, kind = 'info', duration = 4000) => {
    const id = `toast_${++toastId}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind, duration }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  show: (message: string, kind?: ToastKind, duration?: number) => {
    useToastStore.getState().show(message, kind, duration);
  },
  success: (message: string) => toast.show(message, 'success'),
  error: (message: string) => toast.show(message, 'error'),
  warning: (message: string) => toast.show(message, 'warning'),
  info: (message: string) => toast.show(message, 'info'),
};