import { env } from "cloudflare:workers";

export const appleProduct = "de.njora.finanzueberblick.monthly";
export type Membership = { active: boolean; provider: "apple" | "stripe" | null; accountToken: string; webTrialEligible: boolean; stripeCustomer: boolean };
type Subscriber = { user_id: string; account_token: string; stripe_customer: string | null; apple_original: string | null; apple_environment: string | null };
type StripeSubscription = { id: string; status: string; items: { data: { price: { id: string } }[] } };
const bundle = "de.njora.finanzueberblick";

export function billingEnabled() { return env.NJORA_BILLING_ENABLED === "true"; }
function setting(key: string) {
  const value = env[key];
  if (typeof value !== "string" || !value.trim()) throw new Error("Abrechnung ist noch nicht eingerichtet.");
  return value.trim();
}

export async function subscriber(id: string): Promise<Subscriber> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS njora_subscribers (
    user_id TEXT PRIMARY KEY, account_token TEXT NOT NULL UNIQUE, stripe_customer TEXT UNIQUE,
    apple_original TEXT UNIQUE, apple_environment TEXT)`).run();
  await env.DB.prepare("INSERT OR IGNORE INTO njora_subscribers (user_id, account_token) VALUES (?, ?)").bind(id, crypto.randomUUID()).run();
  const row = await env.DB.prepare("SELECT * FROM njora_subscribers WHERE user_id=?").bind(id).first<Subscriber>();
  if (!row) throw new Error("Abrechnungskonto fehlt.");
  return row;
}

async function stripe<T>(path: string, fields?: Record<string, string>, key?: string): Promise<T> {
  const headers: Record<string,string> = { Authorization: "Bearer " + setting("NJORA_STRIPE_SECRET"), "Stripe-Version": "2024-06-20" };
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: fields ? "POST" : "GET", headers, body: fields ? new URLSearchParams(fields) : undefined,
    signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store"
  });
  if (!res.ok) throw new Error("Stripe ist gerade nicht verfügbar.");
  return await res.json() as T;
}

async function subscriptions(customer: string) {
  const response = await stripe<{data: StripeSubscription[]}>("subscriptions?limit=100&status=all&customer=" + encodeURIComponent(customer));
  return response.data.filter(s => s.items.data.some(i => i.price.id === setting("NJORA_STRIPE_PRICE")));
}
function entitled(s: StripeSubscription) { return ["trialing","active"].includes(s.status); }

function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,""); }
async function appleAuthorization() {
  const encode = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const now = Math.floor(Date.now()/1000);
  const body = encode({alg:"ES256",kid:setting("NJORA_APPLE_KEY_ID"),typ:"JWT"})+"."+encode({iss:setting("NJORA_APPLE_ISSUER"),iat:now,exp:now+300,aud:"appstoreconnect-v1",bid:bundle});
  const pem = setting("NJORA_APPLE_PRIVATE_KEY").replaceAll("\\n","\n").replace(/-----[^-]+-----|\s/g,"");
  const key = await crypto.subtle.importKey("pkcs8",Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const signature = await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(body));
  return body+"."+base64url(new Uint8Array(signature));
}

type AppleTransaction = { originalTransactionId: string; bundleId: string; productId: string; appAccountToken?: string; environment: string; revocationDate?: number };
async function appleStatus(id: string, environment: string, token: string) {
  if (!/^\d{1,30}$/.test(id) || !["Production","Sandbox"].includes(environment)) throw new Error("Ungültige Transaktion.");
  const host = environment === "Sandbox" ? "api.storekit-sandbox.apple.com" : "api.storekit.apple.com";
  const res = await fetch("https://"+host+"/inApps/v1/subscriptions/"+id,{headers:{Authorization:"Bearer "+await appleAuthorization()},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)});
  if (!res.ok) throw new Error("Apple konnte den Kauf nicht bestätigen.");
  // Read the status directly from Apple's authenticated TLS endpoint. No client-supplied JWS is accepted.
  const obj = await res.json() as {bundleId:string; environment:string; data:{lastTransactions:{status:number; signedTransactionInfo:string}[]}[]};
  if (obj.bundleId!==bundle || obj.environment!==environment) throw new Error("Die App-Zuordnung stimmt nicht.");
  for (const entry of obj.data.flatMap(group=>group.lastTransactions)) {
    const payload=entry.signedTransactionInfo.split(".")[1];
    const tx=JSON.parse(atob(payload.replaceAll("-","+").replaceAll("_","/"))) as AppleTransaction;
    if(tx.bundleId===bundle && tx.environment===environment && tx.productId===appleProduct && tx.originalTransactionId===id && tx.appAccountToken?.toLowerCase()===token.toLowerCase())
      return { active: !tx.revocationDate && [1,4].includes(entry.status) };
  }
  throw new Error("Der Kauf gehört nicht zu diesem Njora-Konto.");
}

function allowedAppleEnvironment(userId: string, environment: string) {
  if (env.NJORA_APPLE_ENVIRONMENT === "Sandbox") return environment === "Sandbox";
  return environment === "Production" || (environment === "Sandbox" && userId === env.NJORA_APPLE_SANDBOX_REVIEW_USER_ID);
}

export async function confirmApple(row: Subscriber, id: string, environment: string) {
  // Sandbox purchases unlock only the independently configured test environment.
  if (!allowedAppleEnvironment(row.user_id, environment)) throw new Error("Falsche Kaufumgebung.");
  const status = await appleStatus(id,environment,row.account_token);
  if (status.active) await env.DB.prepare("UPDATE njora_subscribers SET apple_original=?, apple_environment=? WHERE user_id=?").bind(id,environment,row.user_id).run();
  return status;
}

export async function membership(row: Subscriber): Promise<Membership> {
  let provider: Membership["provider"] = null;
  const previous = row.stripe_customer ? await subscriptions(row.stripe_customer) : [];
  if (previous.some(entitled)) provider = "stripe";
  else if (row.apple_original && row.apple_environment && allowedAppleEnvironment(row.user_id, row.apple_environment) && (await appleStatus(row.apple_original,row.apple_environment,row.account_token)).active) provider="apple";
  return {active:provider!==null,provider,accountToken:row.account_token,webTrialEligible:!previous.length && !row.apple_original,stripeCustomer:!!row.stripe_customer};
}

export async function checkout(row: Subscriber, email: string) {
  if ((await membership(row)).active) throw new Error("Du hast bereits ein aktives Abo.");
  const priceId = setting("NJORA_STRIPE_PRICE");
  const price = await stripe<{active:boolean;currency:string;unit_amount:number;recurring:{interval:string;interval_count:number};tax_behavior:string}>("prices/"+encodeURIComponent(priceId));
  if (!price.active || price.currency!=="eur" || price.unit_amount!==99 || price.recurring?.interval!=="month" || price.recurring.interval_count!==1 || price.tax_behavior!=="inclusive") throw new Error("Der Monatspreis ist nicht korrekt eingerichtet.");
  if(!row.stripe_customer) {
    const customer=await stripe<{id:string}>("customers",{email,"metadata[njora_account]":row.account_token},"njora-customer-"+row.account_token);
    await env.DB.prepare("UPDATE njora_subscribers SET stripe_customer=? WHERE user_id=? AND stripe_customer IS NULL").bind(customer.id,row.user_id).run();
    row=await subscriber(row.user_id);
  }
  const customer=row.stripe_customer!;
  const previous=await subscriptions(customer);
  if(previous.some(s=>!["canceled","incomplete_expired"].includes(s.status))) return portal(row);
  const sessions=await stripe<{data:{id:string;status:string;url:string|null}[]}>("checkout/sessions?limit=1&customer="+encodeURIComponent(customer));
  const last=sessions.data[0];
  if(last?.status==="open" && last.url) return last.url;
  const fields:Record<string,string>={mode:"subscription",customer,"line_items[0][price]":priceId,"line_items[0][quantity]":"1",
    payment_method_collection:"always",success_url:"https://njora.de/",cancel_url:"https://njora.de/",
    "subscription_data[metadata][njora_account]":row.account_token};
  if (!previous.length && !row.apple_original) {
    fields["subscription_data[trial_period_days]"] = "30";
    fields["subscription_data[trial_settings][end_behavior][missing_payment_method]"] = "cancel";
  }
  const session=await stripe<{url:string}>("checkout/sessions",fields,"njora-checkout-"+row.account_token+"-"+(last?.id??"first"));
  return session.url;
}

export async function portal(row: Subscriber) {
  if (!row.stripe_customer) throw new Error("Kein Stripe-Konto vorhanden.");
  return (await stripe<{url:string}>("billing_portal/sessions",{customer:row.stripe_customer,return_url:"https://njora.de/"})).url;
}

export async function removeBillingAccount(id:string) {
  const exists=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='njora_subscribers'").first();
  if(!exists) return [];
  const row=await env.DB.prepare("SELECT stripe_customer FROM njora_subscribers WHERE user_id=?").bind(id).first<{stripe_customer:string|null}>();
  if(row?.stripe_customer) {
    // This customer is dedicated to Njora. Deletion cancels its subscriptions and prevents future collections.
    const response=await fetch("https://api.stripe.com/v1/customers/"+encodeURIComponent(row.stripe_customer),{method:"DELETE",headers:{Authorization:"Bearer "+setting("NJORA_STRIPE_SECRET")},signal:AbortSignal.timeout(8000)});
    if(!response.ok && response.status!==404) throw new Error("Stripe-Kündigung ausstehend.");
  }
  return [env.DB.prepare("DELETE FROM njora_subscribers WHERE user_id=?").bind(id)];
}
