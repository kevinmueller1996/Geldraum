const paths = {
  today: "M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M16.5 12a4.5 4.5 0 1 0-9 0 4.5 4.5 0 1 0 9 0Z",
  revenue: "M3 4v16h18M8 16v-5m5 5V6m5 10V9",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2-2v4m10-4v4M3 10h18m-14 5h2m4 0h2",
  loans: "M3 5.5h18v13H3zM15 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0ZM6 12h.1m11.8 0h.1",
  goals: "M21 12a9 9 0 1 0-18 0 9 9 0 1 0 18 0ZM17 12a5 5 0 1 0-10 0 5 5 0 1 0 10 0Zm-5 0h.01",
  more: "M5 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 1 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 1 0 0-2Z",
  next: "m9 5 7 7-7 7",
  back: "m15 5-7 7 7 7",
  forward: "M4 12h16m-7-7 7 7-7 7",
  external: "M6 18 18 6M7 6h11v11",
  retry: "M20 5v6h-6m6 0a8 8 0 1 0-1.5 6",
  share: "M12 15V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3",
  check: "m4 12 5 5L20 6",
};

export type IconName = keyof typeof paths;

export function UiIcon({ name }: { name: IconName }) {
  return <svg className="ui-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
