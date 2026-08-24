import { create } from 'zustand';

interface PermissionState {
  permissions: Set<string>;
  loaded: boolean;
  setPermissions: (perms: string[]) => void;
  hasPermission: (key: string) => boolean;
  reset: () => void;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  permissions: new Set(),
  loaded: false,
  setPermissions: (perms) => set({ permissions: new Set(perms), loaded: true }),
  hasPermission: (key) => get().permissions.has(key),
  reset: () => set({ permissions: new Set(), loaded: false }),
}));