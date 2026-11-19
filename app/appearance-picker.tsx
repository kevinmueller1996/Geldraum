"use client";

import { useEffect, useState } from "react";

const names = { original: "Njora Original", sage: "Salbei", fjord: "Fjordblau" };
type Appearance = keyof typeof names;
const storageKey = "njora.appearance";

function readPreference(value: string | null): Appearance {
  return value === "sage" || value === "fjord" ? value : "original";
}

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>("original");

  useEffect(() => {
    try { setAppearance(readPreference(window.localStorage.getItem(storageKey))); } catch { /* Storage may be disabled. */ }
    function sync(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) setAppearance(readPreference(event.newValue));
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function select(next: Appearance) {
    setAppearance(next);
    try { window.localStorage.setItem(storageKey, next); } catch { /* The selection still applies in this tab. */ }
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
