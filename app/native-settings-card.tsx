"use client";

import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";

const REMINDER_ID = 260809;

export default function NativeSettingsCard({ cadence }: { cadence: "daily" | "weekly" }) {
  const [native, setNative] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setNative(Capacitor.isNativePlatform()), []);
  if (!native) return null;

  async function activateReminder() {
    setBusy(true);
    setMessage("");
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display !== "granted") {
        setMessage("Benachrichtigungen sind noch nicht erlaubt. Du kannst sie in den iPhone-Einstellungen freigeben.");
        return;
      }
      await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
      await LocalNotifications.schedule({ notifications: [{
        id: REMINDER_ID,
        title: "Zeit für deinen Njora-Check-in",
        body: cadence === "daily" ? "Ein kurzer Blick genügt, um den Überblick zu behalten." : "Aktualisiere deine Kontostände und sieh, was sich verändert hat.",
        schedule: cadence === "daily"
          ? { on: { hour: 19, minute: 0 }, repeats: true }
          : { on: { weekday: 1, hour: 19, minute: 0 }, repeats: true },
        extra: { destination: "check-in" },
      }] });
      setMessage(cadence === "daily" ? "Tägliche Erinnerung um 19:00 Uhr ist aktiv." : "Wöchentliche Erinnerung sonntags um 19:00 Uhr ist aktiv.");
    } catch {
      setMessage("Die Erinnerung konnte gerade nicht eingerichtet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function disableReminder() {
    setBusy(true);
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
      setMessage("Die Check-in-Erinnerung ist ausgeschaltet.");
    } catch {
      setMessage("Die Erinnerung konnte gerade nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  }

  return <article className="native-settings-card">
    <span className="native-app-badge">Njora für iPhone</span>
    <div><strong>Check-in-Erinnerung</strong><small>Njora erinnert dich passend zu deinem gewählten Rhythmus – direkt auf dem iPhone.</small></div>
    <div className="native-settings-actions">
      <button type="button" disabled={busy} onClick={activateReminder}>{busy ? "Einen Moment …" : "Erinnerung aktivieren"}</button>
      <button type="button" disabled={busy} onClick={disableReminder}>Ausschalten</button>
    </div>
    {message && <p role="status">{message}</p>}
  </article>;
}
