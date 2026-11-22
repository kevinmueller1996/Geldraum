"use client";

import { useSyncExternalStore } from "react";

const names = { original: "Njora Original", sage: "Salbei", fjord: "Fjordblau" };
type Appearance = keyof typeof names;
const storageKey = "njora.appearance";

function readPreference(value: string | null): Appearance {
  return value === "sage" || value === "fjord" ? value : "original";
}

let temporaryPreference: Appearance | undefined;
function getAppearance(): Appearance {
  if (temporaryPreference) return temporaryPreference;
  try { return readPreference(window.localStorage.getItem(storageKey)); }
  catch { return "original"; }
}

function subscribeAppearance(listener: () => void) {
  function sync(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) {
      temporaryPreference = undefined;
      listener();
    }
  }
  window.addEventListener("storage", sync);
  window.addEventListener("njora-appearance", listener);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener("njora-appearance", listener);
  };
}

export function useAppearance() {
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance, () => "original" as const);
  function select(next: Appearance) {
    try {
      window.localStorage.setItem(storageKey, next);
      temporaryPreference = undefined;
    } catch {
      temporaryPreference = next;
    }
    window.dispatchEvent(new Event("njora-appearance"));
  }
  return { appearance, select };
}

export function AppearancePicker({ appearance, select }: ReturnType<typeof useAppearance>) {
  return <fieldset className="appearance-picker">
    <legend>Erscheinungsbild</legend>
    <div>{(Object.keys(names) as Appearance[]).map(option =>
      <label key={option} data-option={option}>
        <input type="radio" name="appearance" checked={option === appearance} onChange={() => select(option)} />
        <span className="appearance-swatch" aria-hidden="true" />
        {names[option]}
      </label>
    )}</div>
  </fieldset>;
}
