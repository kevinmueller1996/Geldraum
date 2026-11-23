export type Space = "private" | "business";
export type Access = "view" | "edit";
export type Grant = {id:string;role:Access;workspace:Space;active:number;email:string};
export type Grants = {owned:Grant[];received:Grant[]};

export class ShareError extends Error {
  constructor(message:string, readonly status:number) { super(message); }
}
let sessionBinding = "";
export async function sharing<T>(workspace:Space, action:string, fields:Record<string,unknown> = {}, method="POST"):Promise<T> {
  const headers:Record<string,string> = {"Content-Type":"application/json","x-njora-browser":"1"};
  if (sessionBinding) headers["x-njora-browser-session"]=sessionBinding;
  const response = await fetch("/api/sharing", {method, cache:"no-store", headers,
    body:JSON.stringify({...fields,workspace,action}), signal:AbortSignal.timeout(15000)});
  const payload = await response.json();
  if (!response.ok) throw new ShareError(payload.error ?? "Die Freigabe konnte nicht geladen werden.",response.status);
  sessionBinding = response.headers.get("x-njora-browser-session") || sessionBinding;
  return payload;
}
