import type { Plan, CloudUser } from "./page";
import type { BillingStatus } from "./billing/offer";
import { markerName } from "./browser-session";

export type Remote = { otherWorkspaceName?: string | null; user: CloudUser; billing?: BillingStatus; plan: Plan | null; revision: number | null; updatedAt: string | null };
export type Copy = Remote & { session: string; draft: Plan | null; sending: Plan | null };
export type Choice = "device" | "cloud";
export class Conflict extends Error {}
export class SessionChanged extends Error {}

export function currentSession() {
  const prefix = markerName(location.hostname) + "=";
  return document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => equal(a[key], b[key]));
}
export function pending(copy: Copy) { return !!copy.sending || !equal(copy.plan, copy.draft); }

function merge(base: unknown, local: unknown, cloud: unknown, choice?: Choice, key = "id"): unknown {
  if (equal(local, cloud) || equal(base, cloud)) return local;
  if (equal(base, local)) return cloud;
  if (object(base) && object(local) && object(cloud)) {
    const pairs = [...new Set([...Object.keys(local), ...Object.keys(cloud)])].map(k => {
      let original = base[k];
      if (original === undefined && k === "monthlyRevenue" && object(local[k]) && object(cloud[k])) original = {};
      if (original === undefined && k === "flexibleCosts" && Array.isArray(local[k]) && Array.isArray(cloud[k])) original = [];
      return [k, merge(original, local[k], cloud[k], choice, k === "snapshots" ? "date" : "id")] as const;
    });
    return Object.fromEntries(pairs.filter(([,v]) => v !== undefined));
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(cloud)) {
    const indexes = [base, local, cloud].map(list => new Map(list.map(v => [v?.[key], v])));
    if (indexes.every((map, i) => map.size === [base,local,cloud][i].length && [...map.keys()].every(k => typeof k === "string"))) {
      const [b,l,r] = indexes;
      return [...new Set([...r.keys(), ...l.keys()])].map(k => merge(b.get(k), l.get(k), r.get(k), choice)).filter(v => v !== undefined);
    }
  }
  if (!choice) throw new Conflict();
  return choice === "device" ? local : cloud;
}

export function mergeDraft(base: Plan | null, draft: Plan | null, latest: Plan | null, choice?: Choice) {
  return merge(base, draft, latest, choice) as Plan | null;
}
export function differentAccount(a: CloudUser, b: CloudUser) {
  return Boolean(a.accountCreatedAt && b.accountCreatedAt && a.accountCreatedAt !== b.accountCreatedAt);
}

export function bindBrowserCopy(saved: Copy | undefined, reply: Remote, session: string): Copy {
  const oldCreation = saved?.user.accountCreatedAt;
  const newCreation = reply.user.accountCreatedAt;
  // Older clients did not store account creation. A fresh session with a lower revision
  // cannot safely reuse an offline plan belonging to the previous account at this address.
  const legacyReset = saved && (!oldCreation || !newCreation) && saved.session !== session
    && (reply.revision ?? 0) < (saved.revision ?? 0);
  if (!saved || differentAccount(saved.user, reply.user) || legacyReset) return { ...reply, session, draft: reply.plan, sending: null };
  return { ...saved, session, otherWorkspaceName: reply.otherWorkspaceName, billing: reply.billing, user: reply.user };
}

export function reconcile(copy: Copy, reply: Remote, choice?: Choice): Copy {
  if ((copy.revision ?? 0) > (reply.revision ?? 0)) return copy;
  const draft = copy.sending && !equal(copy.draft, reply.plan)
    ? mergeDraft(copy.sending, copy.draft, mergeDraft(copy.plan, copy.sending, reply.plan, choice), choice)
    : mergeDraft(copy.plan, copy.draft, reply.plan, choice);
  return { ...reply, session: copy.session, draft, sending: null };
}

const databases = new Map<boolean, Promise<IDBDatabase>>();
function open(business: boolean) {
  let database = databases.get(business);
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(business ? "njora-business-plans" : "njora-browser-plans", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("plans").createIndex("session", "session");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { databases.delete(business); reject(request.error); };
    });
    databases.set(business, database);
  }
  return database;
}
export async function offlineCopy(session: string, business = false) {
  const db = await open(business);
  return new Promise<Copy | undefined>((resolve,reject) => {
    const query = db.transaction("plans").objectStore("plans").index("session").get(session);
    query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error);
  });
}

// IndexedDB serializes read/modify/write across tabs. Resolve only after the transaction commits.
export async function updateCopy(email: string, session: string, change: (copy?: Copy) => Copy | undefined, remove = false, business = false) {
  const db = await open(business);
  return new Promise<Copy | undefined>((resolve,reject) => {
    const tx = db.transaction("plans", "readwrite");
    const store = tx.objectStore("plans"), key = email.trim().toLowerCase();
    const read = store.get(key);
    let next: Copy | undefined;
    read.onsuccess = () => {
      try {
        if (!remove && currentSession() !== session) throw new SessionChanged();
        next = change(read.result);
        if (next) store.put(next, key); else store.delete(key);
      } catch (error) { tx.abort(); reject(error); }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(tx.error ?? new Error("Lokale Speicherung fehlgeschlagen"));
  });
}
