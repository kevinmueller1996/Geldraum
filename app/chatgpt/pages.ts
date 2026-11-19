import { base } from "./config";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
}
export function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Njora</title><style>
:root{color-scheme:light dark;--paper:#fbf7f3;--ink:#2d211f;--btn:#653c33;--surface:#fff;--line:#d7cbc5}
@media(prefers-color-scheme:dark){:root{--paper:#241d1a;--ink:#faf5f1;--btn:#f2b99f;--surface:#302825;--line:#63544e}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.55 system-ui,sans-serif}main{max-width:36rem;margin:8vh auto;padding:1.6rem}img{width:3rem;height:3rem;border-radius:.8rem}h1{font-size:1.8rem;line-height:1.2}form,section{margin:1.4rem 0}li{margin:.45rem 0}.actions{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.4rem}button,.button{font:inherit;font-weight:600;cursor:pointer;background:var(--btn);color:var(--paper);border:1px solid var(--btn);border-radius:.6rem;padding:.65rem 1rem;text-decoration:none}.secondary{background:transparent;color:var(--ink);border-color:var(--line)}a{color:inherit}footer{margin-top:2rem;font-size:.9rem}
</style><main><img alt="Njora" src="/njora-mark.png"><h1>${escapeHtml(title)}</h1>${body}<footer><a href="/datenschutz">Datenschutz</a> · <a href="/support">Support</a></footer></main></html>`,{
    status, headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-frame-options":"DENY","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'"}
  });
}
export function loginPage(url: URL) {
  const path = url.pathname + url.search;
  return page("Bei Njora anmelden", `<p>Melde dich bei deinem Njora-Konto an, um fortzufahren.</p><a class="button" href="/login?weiter=${encodeURIComponent(path)}#zugang">Zur Anmeldung</a>`);
}
export const manageLink = `<a href="${base}/manage">Verbindung verwalten</a>`;

