"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Read browser-only capabilities after hydration with matching server and first-client output. */
export function useBrowserReady() {
  return useSyncExternalStore(subscribe, clientReady, serverReady);
}
