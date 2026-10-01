// The sign-in and consent pages the OAuth server sends the app to
// (architecture §3.5 "Comptes et connexion"). Server-rendered, no framework,
// nothing loaded from elsewhere: they must work on a slow phone connection.
// Strings live in STRINGS until @baarali/i18n exists (roadmap phase 1).

export interface SignInMethods {
  email: boolean;
  phone: boolean;
  social: string[];
}

type Lang = 'fr' | 'en';

const STRINGS = {
  fr: {
    title: 'Connexion à Baarali',
    lead: 'Pas de mot de passe : on vous envoie un code.',
    continueWith: 'Continuer avec',
    or: 'ou',
    email: 'Adresse email',
    phone: 'Numéro de téléphone',
    phoneHint: 'Côte d’Ivoire, Burkina Faso, Bénin, Sénégal, Togo, Mali, Niger. Ailleurs, utilisez l’email.',
    sendCode: 'Recevoir un code',
    code: 'Code à 6 chiffres',
    codeSent: 'Si cette adresse ou ce numéro peut le recevoir, un code vient de partir. Il est valable 5 minutes.',
    signIn: 'Se connecter',
    otherMethod: 'Utiliser un autre moyen',
    failed: 'Ça n’a pas marché. Vérifiez et réessayez.',
    tooMany: 'Trop d’essais. Patientez une minute.',
    none: 'Aucun moyen de connexion n’est ouvert pour le moment.',
    consentTitle: 'Autoriser l’application ?',
    consentBody: 'L’application Baarali sur cet appareil pourra agir avec votre compte : vos conversations, votre usage et vos crédits. Vous pourrez retirer cet accès depuis vos réglages.',
    allow: 'Autoriser',
    deny: 'Refuser',
  },
  en: {
    title: 'Sign in to Baarali',
    lead: 'No password: we send you a code.',
    continueWith: 'Continue with',
    or: 'or',
    email: 'Email address',
    phone: 'Phone number',
    phoneHint: 'Côte d’Ivoire, Burkina Faso, Benin, Senegal, Togo, Mali, Niger. Elsewhere, use email.',
    sendCode: 'Get a code',
    code: '6-digit code',
    codeSent: 'If this address or number can receive it, a code is on its way. It is valid for 5 minutes.',
    signIn: 'Sign in',
    otherMethod: 'Use another method',
    failed: 'That did not work. Check and try again.',
    tooMany: 'Too many attempts. Wait a minute.',
    none: 'No sign-in method is open right now.',
    consentTitle: 'Allow the app?',
    consentBody: 'The Baarali app on this device will act with your account: your conversations, your usage and your credits. You can remove this access from your settings.',
    allow: 'Allow',
    deny: 'Deny',
  },
} satisfies Record<Lang, Record<string, string>>;

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', apple: 'Apple', github: 'GitHub', microsoft: 'Microsoft' };

export function pickLang(acceptLanguage: string | null): Lang {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'fr';
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(lang: Lang, title: string, nonce: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style nonce="${nonce}">
:root { --bg:#f7f7f5; --card:#ffffff; --ink:#18181b; --muted:#5f5f66; --line:#dcdcd8; --accent:#18181b; --on-accent:#ffffff; --error:#b42318; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#111113; --card:#1b1b1e; --ink:#f2f2f0; --muted:#a3a3a8; --line:#2e2e33; --accent:#f2f2f0; --on-accent:#111113; --error:#f97066; color-scheme: dark; } }
* { box-sizing: border-box; }
/* .stack sets display:grid, which would beat the hidden attribute (seen 01/10/2026). */
[hidden] { display: none !important; }
body { margin:0; min-height:100svh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px 24px; display:grid; gap:16px; }
h1 { margin:0; font-size:22px; line-height:1.25; text-wrap:balance; }
p { margin:0; color:var(--muted); }
form, .stack { display:grid; gap:10px; }
label { font-size:14px; color:var(--muted); }
/* 16 px at least: below it, iPhone zooms into the field. */
input { width:100%; font:inherit; font-size:16px; padding:12px; border:1px solid var(--line); border-radius:10px; background:transparent; color:var(--ink); }
input:focus-visible, button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
button { font:inherit; font-weight:600; padding:12px; border-radius:10px; border:1px solid var(--line); background:transparent; color:var(--ink); cursor:pointer; }
button.primary { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
button:disabled { opacity:.6; cursor:default; }
.or { display:flex; align-items:center; gap:10px; color:var(--muted); font-size:14px; }
.or::before, .or::after { content:""; flex:1; border-top:1px solid var(--line); }
.hint { font-size:13px; }
.error { color:var(--error); font-size:14px; }
.link { border:none; padding:0; font-weight:400; text-decoration:underline; color:var(--muted); justify-self:start; }
</style>
</head>
<body>
<main>
${body}
</main>
<script nonce="${nonce}">
"use strict";
// Better Auth signs the authorization request into this page's query; it
// comes back with every call so the flow resumes once the person is in.
const oauthQuery = location.search.slice(1);
async function post(path, body) {
  const res = await fetch("/auth/v1" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, oauth_query: oauthQuery }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("failed"), { status: res.status });
  return data;
}
function follow(data) {
  if (data && typeof data.url === "string") location.assign(data.url);
}
${script}
</script>
</body>
</html>`;
}

export function signInPage(opts: { methods: SignInMethods; lang: string | null; nonce: string }): string {
  const lang = pickLang(opts.lang);
  const t = STRINGS[lang];
  const { methods } = opts;
  const social = methods.social
    .map((p) => `<button type="button" data-provider="${escape(p)}">${escape(t.continueWith)} ${escape(PROVIDER_NAMES[p] ?? p)}</button>`)
    .join('\n');
  const codeForms = [
    methods.email
      ? `<form data-kind="email"><label for="email">${escape(t.email)}</label><input id="email" name="target" type="email" autocomplete="email" inputmode="email" required></form>`
      : '',
    methods.phone
      ? `<form data-kind="phone"><label for="phone">${escape(t.phone)}</label><input id="phone" name="target" type="tel" autocomplete="tel" inputmode="tel" placeholder="+225 07 00 00 00 00" required><p class="hint">${escape(t.phoneHint)}</p></form>`
      : '',
  ].filter(Boolean);
  const any = social || codeForms.length > 0;
  const body = `
<h1>${escape(t.title)}</h1>
${any ? `<p>${escape(t.lead)}</p>` : `<p>${escape(t.none)}</p>`}
${social ? `<div class="stack">${social}</div>` : ''}
${social && codeForms.length ? `<div class="or">${escape(t.or)}</div>` : ''}
<div class="stack" id="ask">${codeForms.join(`<div class="or">${escape(t.or)}</div>`)}
${codeForms.length ? `<button class="primary" id="send" type="button">${escape(t.sendCode)}</button>` : ''}</div>
<form id="verify" class="stack" hidden>
  <p>${escape(t.codeSent)}</p>
  <label for="code">${escape(t.code)}</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
  <button class="primary" type="submit">${escape(t.signIn)}</button>
  <button class="link" type="button" id="back">${escape(t.otherMethod)}</button>
</form>
<p class="error" id="error" role="alert" hidden></p>`;
  const script = `
const t = ${JSON.stringify({ failed: t.failed, tooMany: t.tooMany })};
const error = document.getElementById("error");
function fail(e) { error.textContent = e && e.status === 429 ? t.tooMany : t.failed; error.hidden = false; }
for (const b of document.querySelectorAll("[data-provider]")) {
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { follow(await post("/sign-in/social", { provider: b.dataset.provider, callbackURL: "/auth/v1/sign-in" })); }
    catch (e) { fail(e); b.disabled = false; }
  });
}
let target = null;
const send = document.getElementById("send");
const verify = document.getElementById("verify");
async function ask() {
  error.hidden = true;
  const filled = [...document.querySelectorAll("form[data-kind]")].find((f) => f.elements.target.value.trim());
  if (!filled) return;
  const id = filled.elements.target.value.trim();
  target = { kind: filled.dataset.kind, id: filled.dataset.kind === "phone" ? id.replace(/[\\s.-]/g, "") : id };
  send.disabled = true;
  try {
    if (target.kind === "email") await post("/email-otp/send-verification-otp", { email: target.id, type: "sign-in" });
    else await post("/phone-number/send-otp", { phoneNumber: target.id });
    document.getElementById("ask").hidden = true;
    verify.hidden = false;
    document.getElementById("code").focus();
  } catch (e) { fail(e); }
  send.disabled = false;
}
if (send) send.addEventListener("click", ask);
for (const f of document.querySelectorAll("form[data-kind]")) f.addEventListener("submit", (e) => { e.preventDefault(); ask(); });
verify.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const code = document.getElementById("code").value.trim();
  try {
    follow(target.kind === "email"
      ? await post("/sign-in/email-otp", { email: target.id, otp: code })
      : await post("/phone-number/verify", { phoneNumber: target.id, code }));
  } catch (err) { fail(err); }
});
document.getElementById("back").addEventListener("click", () => {
  verify.hidden = true;
  document.getElementById("ask").hidden = false;
});`;
  return layout(lang, t.title, opts.nonce, body, script);
}

export function consentPage(opts: { lang: string | null; nonce: string }): string {
  const lang = pickLang(opts.lang);
  const t = STRINGS[lang];
  const body = `
<h1>${escape(t.consentTitle)}</h1>
<p>${escape(t.consentBody)}</p>
<div class="stack">
  <button class="primary" id="allow" type="button">${escape(t.allow)}</button>
  <button id="deny" type="button">${escape(t.deny)}</button>
</div>
<p class="error" id="error" role="alert" hidden></p>`;
  const script = `
const error = document.getElementById("error");
for (const [id, accept] of [["allow", true], ["deny", false]]) {
  document.getElementById(id).addEventListener("click", async () => {
    try { follow(await post("/oauth2/consent", { accept })); }
    catch { error.textContent = ${JSON.stringify(t.failed)}; error.hidden = false; }
  });
}`;
  return layout(lang, t.consentTitle, opts.nonce, body, script);
}
