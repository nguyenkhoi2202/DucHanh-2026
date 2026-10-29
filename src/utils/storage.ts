// Per-account browser storage. Both clinics may be used from the same browser, so every
// key is prefixed with the clinic and username: one account's preferences never leak into,
// or get overwritten by, the other's. Only small UI conveniences live here; patient data
// is always on the server.
export interface ScopedStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function scopedStorage(clinicSlug: string, username: string): ScopedStorage {
  const prefix = `nhakhoa:${clinicSlug}:${username.toLowerCase()}:`;
  return {
    get(key) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null; // storage unavailable (private mode, blocked site data)
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, value);
      } catch {
        // ignore: these are conveniences only
      }
    },
  };
}
