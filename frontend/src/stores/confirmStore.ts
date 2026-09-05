import { create } from 'zustand';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  content?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'default';
  width?: number;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,

  confirm: (options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      set({ open: true, options, resolve });
    });
  },

  handleConfirm: () => {
    const { resolve } = get();
    resolve?.(true);
    set({ open: false, options: null, resolve: null });
  },

  handleCancel: () => {
    const { resolve } = get();
    resolve?.(false);
    set({ open: false, options: null, resolve: null });
  },
}));

export const confirm = (options: ConfirmOptions) => useConfirmStore.getState().confirm(options);