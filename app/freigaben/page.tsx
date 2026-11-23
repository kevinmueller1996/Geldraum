"use client";

import { FormEvent, useEffect, useState } from "react";
import LegalPage from "../legal-page";
import { Access, Grant, Grants, ShareError, sharing, Space } from "./client";
import "./sharing.css";

function title(space:Space) { return space === "private" ? "Privat" : "Business"; }
function permissions(role:Access) { return role === "view" ? "Ansehen" : "Mitbearbeiten"; }

export default function Shares() {
  const [space,setSpace] = useState<Space|null>(null);
  useEffect(() => { setSpace(new URLSearchParams(location.search).get("bereich")==="business" ? "business" : "private"); },[]);
  return <LegalPage title="Geteilte Finanzbereiche">{space && <Manage key={space} space={space} />}</LegalPage>;
}

function Manage({space}:{space:Space}) {
  const [list,setList] = useState<Grants|null>(null);
  const [email,setEmail] = useState("");
  const [role,setRole] = useState<Access>("view");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [reload,setReload] = useState(0);
  const [confirm,setConfirm] = useState<Grant|null>(null);
  const path = "/freigaben?bereich="+space;
  useEffect(() => {
    let current=true;
    sharing<Grants>(space,"list").then(r=>{if(current) setList(r);}).catch(e=>{
      if (!current) return;
      setList(null);
      if(e instanceof ShareError && e.status===401) location.replace("/login?weiter="+encodeURIComponent(path));
      else setMessage(e.message || "Freigaben konnten nicht geladen werden.");
    });
    return ()=>{current=false;};
  },[space,path,reload]);
  async function act(action:string, fields:Record<string,unknown>, success:string) {
    setBusy(true); setMessage("");
    try {
      const result = await sharing<{mailed?:boolean}>(space,action,fields); setConfirm(null);
      if(action==="invite") setEmail("");
      setMessage(action==="invite" && result.mailed ? "Einladung per E-Mail verschickt." : success); setReload(n=>n+1);
    } catch(e) { setMessage(e instanceof Error ? e.message : "Bitte versuche es erneut."); }
    finally { setBusy(false); }
  }
  function invite(event:FormEvent) {
    event.preventDefault();
    void act("invite",{email,role},"Einladung angelegt. Sende der Person den Einladungslink.");
  }
  const inviteLink = "https://njora.de"+path;
  return <div className="share-panel">
    <nav aria-label="Finanzbereich">{(["private","business"] as const).map(s=><a key={s} href={"/freigaben?bereich="+s} aria-current={s===space?"page":undefined}>{title(s)}</a>)}</nav>
    <h2>{title(space)} teilen</h2><p>Die eingeladene Person braucht ein eigenes bestätigtes Njora-Konto. Ihr Zugriff auf die Finanzdaten dieses Bereichs ist in deinem Abo enthalten.</p>
    <form onSubmit={invite}><label>E-Mail-Adresse<input required type="email" autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label>Berechtigung<select value={role} onChange={e=>setRole(e.target.value as Access)}><option value="view">Nur ansehen</option><option value="edit">Mitbearbeiten</option></select></label>
      <button disabled={busy || !list}>Einladung erstellen</button></form>
    {message && <p role="status">{message}</p>}
    {!list && <button onClick={()=>setReload(n=>n+1)}>Freigaben laden</button>}
    {list && <><h2>Von dir freigegeben</h2>{!list.owned.length && <p>Du hast noch niemanden eingeladen.</p>}
      {list.owned.map(g=><div className="share-row" key={g.id}><div><strong>{g.email}</strong><small>{permissions(g.role)} · {g.active?"Angenommen":"Einladung offen"}</small></div>
        {!g.active && <a href={"mailto:"+encodeURIComponent(g.email)+"?subject="+encodeURIComponent("Njora · Einladung für "+title(space))+"&body="+encodeURIComponent("Ich lade dich in meinen Finanzbereich „"+title(space)+"“ ein. Melde dich innerhalb von sieben Tagen mit "+g.email+" bei Njora an und nimm die Einladung an.\n\n"+inviteLink)}>Link per E-Mail teilen</a>}
        <button disabled={busy} onClick={()=>setConfirm(g)}>Widerrufen</button></div>)}
      <h2>Mit dir geteilt</h2>{!list.received.length && <p>Für diesen Bereich liegen keine Freigaben vor.</p>}
      {list.received.map(g=><div className="share-row" key={g.id}><div><strong>{g.email}</strong><small>{permissions(g.role)}</small></div>
        {g.active ? <a href={"/?bereich="+space+"&freigabe="+g.id}>Finanzplan öffnen</a> : <button disabled={busy} onClick={()=>void act("accept",{id:g.id},"Einladung angenommen.")}>Annehmen</button>}
        <button disabled={busy} onClick={()=>setConfirm(g)}>{g.active?"Freigabe verlassen":"Ablehnen"}</button></div>)}
    </>}
    {confirm && <div role="group" aria-label="Freigabe beenden"><p>Freigabe für {confirm.email} im Bereich {title(space)} beenden?</p><button disabled={busy} onClick={()=>void act("remove",{id:confirm.id},"Freigabe beendet.")}>Ja, beenden</button> <button onClick={()=>setConfirm(null)}>Abbrechen</button></div>}
    <a href={space==="business"?"/?bereich=business":"/"}>Zu meinem Finanzplan</a>
  </div>;
}
