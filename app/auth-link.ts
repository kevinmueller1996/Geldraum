"use client";

import { useState, useSyncExternalStore } from "react";

const serverToken = () => null;

export function useAuthLinkToken() {
  const [store] = useState(() => {
    let token: string | null = null;
    return {
      read: () => token,
      subscribe(notify: () => void) {
        function readLink() {
          if (!location.hash && token !== null) return;
          token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
          if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
          notify();
        }
        readLink();
        window.addEventListener("hashchange", readLink);
        return () => window.removeEventListener("hashchange", readLink);
      },
    };
  });
  return useSyncExternalStore(store.subscribe, store.read, serverToken);
}

export class AuthResponseError extends Error {}

export function authMessage(error: unknown, fallback: string) {
  return error instanceof AuthResponseError ? error.message : fallback;
}
