import { invoke } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

/**
 * zustand persist storage backed by the Tauri `load_app_state` / `save_app_state`
 * commands, with a one-time localStorage migration fallback for the given key.
 */
export function createSyncStorage(name: string, localStorageKey?: string): StateStorage {
  return {
    getItem: async () => {
      try {
        const content: string = await invoke('load_app_state', { name });
        return content;
      } catch {
        if (localStorageKey) {
          const oldData = localStorage.getItem(localStorageKey);
          if (oldData !== null) {
            try {
              await invoke('save_app_state', { name, content: oldData });
              localStorage.removeItem(localStorageKey);
            } catch {
              // ignore save errors during migration
            }
            return oldData;
          }
        }
        return null;
      }
    },
    setItem: async (_, value) => {
      await invoke('save_app_state', { name, content: value });
    },
    removeItem: async () => {
      // no-op: app state deletion is not exposed
    },
  };
}
