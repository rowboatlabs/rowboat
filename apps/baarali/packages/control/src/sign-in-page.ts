// The sign-in and consent pages the OAuth server sends the app to
// (architecture §3.5 "Comptes et connexion"). Server-rendered, no framework,
// nothing loaded from elsewhere: they must work on a slow phone connection.
// Strings live in STRINGS until @baarali/i18n exists (roadmap phase 1).

import { PASSWORD_MAX, PASSWORD_MIN } from './password-limits.js';
import { FAVICON, logoTile, logoWord, LOGO_ALIVE_CSS, LOGO_ALIVE_JS, logoTileLive } from './logo.js';

export interface SignInMethods {
  email: boolean;
  phone: boolean;
  social: string[];
}

type Lang = 'fr' | 'en';

const STRINGS = {
  fr: {
    title: 'Connexion à Baarali',
    // One door for both (02/10/2026): an account is created at its first sign-in.
    heading: 'Se connecter ou créer un compte',
    lead: 'Pas encore de compte ? Il se crée à votre première connexion, gratuitement.',
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
    password: 'Mot de passe',
    usePassword: 'Se connecter avec un mot de passe',
    useCode: 'Recevoir un code à la place',
    noPassword: 'Pas encore de mot de passe, ou oublié ?',
    choosePassword: 'Choisir un mot de passe (facultatif)',
    newPassword: 'Nouveau mot de passe',
    passwordHint: 'Pour vous connecter ensuite sans code. 8 caractères au moins.',
    shortPassword: 'Le mot de passe doit faire 8 caractères au moins.',
    badPassword: 'Adresse ou mot de passe incorrect.',
    failed: 'Ça n’a pas marché. Vérifiez et réessayez.',
    tooMany: 'Trop d’essais. Patientez une minute.',
    none: 'Aucun moyen de connexion n’est ouvert pour le moment.',
    consentTitle: 'Autoriser l’application ?',
    consentBody: 'L’application Baarali sur cet appareil pourra agir avec votre compte : vos conversations, votre usage et vos crédits. Vous pourrez retirer cet accès depuis vos réglages.',
    allow: 'Autoriser',
    deny: 'Refuser',
    done: 'Vous êtes connecté',
    doneBody: 'Votre compte Baarali est prêt. Ouvrez l’application Baarali pour continuer.',
    home: 'Retour à l’accueil',
  },
  en: {
    title: 'Sign in to Baarali',
    heading: 'Sign in or create an account',
    lead: 'No account yet? It is created at your first sign-in, free.',
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
    password: 'Password',
    usePassword: 'Sign in with a password',
    useCode: 'Get a code instead',
    noPassword: 'No password yet, or forgot it?',
    choosePassword: 'Choose a password (optional)',
    newPassword: 'New password',
    passwordHint: 'To sign in next time without a code. 8 characters at least.',
    shortPassword: 'The password needs 8 characters at least.',
    badPassword: 'Wrong email or password.',
    failed: 'That did not work. Check and try again.',
    tooMany: 'Too many attempts. Wait a minute.',
    none: 'No sign-in method is open right now.',
    consentTitle: 'Allow the app?',
    consentBody: 'The Baarali app on this device will act with your account: your conversations, your usage and your credits. You can remove this access from your settings.',
    allow: 'Allow',
    deny: 'Deny',
    done: 'You are signed in',
    doneBody: 'Your Baarali account is ready. Open the Baarali app to continue.',
    home: 'Back to home',
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
<link rel="icon" href="${FAVICON}">
<style nonce="${nonce}">
/* The home page's look (01/10/2026): its font, from this origin, and the brand blue. */
@font-face { font-family:"Inter"; src:url(/assets/inter.woff2) format("woff2"); font-weight:400 800; font-display:swap; }
@font-face { font-family:"Source Serif 4"; src:url(/assets/source-serif-4.woff2) format("woff2"); font-weight:400 700; font-style:normal; font-display:swap; }
:root { --bg:#f4f6fb; --card:#ffffff; --ink:#0a0a0a; --muted:#5d6271; --line:#e1e4ec; --accent:#155eef; --on-accent:#ffffff; --error:#b42318; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b0c0f; --card:#15161b; --ink:#f5f6f8; --muted:#9a9fac; --line:#26282f; --accent:#1a6dff; --on-accent:#ffffff; --error:#f97066; color-scheme: dark; } }
* { box-sizing: border-box; }
/* .stack sets display:grid, which would beat the hidden attribute (seen 01/10/2026). */
[hidden] { display: none !important; }
body { margin:0; min-height:100svh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--ink); font:16px/1.5 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
main { width:100%; max-width:400px; background:var(--card); border:1px solid var(--line); border-radius:22px; padding:32px 28px; box-shadow:0 30px 60px -40px rgb(10 10 10 / .35); display:grid; gap:16px; }
.logo { display:flex; align-items:center; gap:8px; font-weight:800; font-size:18px; letter-spacing:-.02em; color:var(--ink); text-decoration:none; }
h1 { margin:0; font-family:"Source Serif 4", Georgia, serif; font-weight:500; font-size:27px; letter-spacing:-.015em; line-height:1.25; text-wrap:balance; }
p { margin:0; color:var(--muted); }
form, .stack { display:grid; gap:10px; }
label { font-size:14px; color:var(--muted); }
/* 16 px at least: below it, iPhone zooms into the field. */
input { width:100%; font:inherit; font-size:16px; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:transparent; color:var(--ink); }
input:focus-visible, button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
button { font:inherit; font-weight:600; padding:12px; border-radius:999px; border:1px solid var(--line); background:transparent; color:var(--ink); cursor:pointer; }
button.primary { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
button:disabled { opacity:.6; cursor:default; }
.or { display:flex; align-items:center; gap:10px; color:var(--muted); font-size:14px; }
.or::before, .or::after { content:""; flex:1; border-top:1px solid var(--line); }
.hint { font-size:13px; }
.error { color:var(--error); font-size:14px; }
.link { border:none; padding:0; font-weight:400; text-decoration:underline; color:var(--muted); justify-self:start; }
${LOGO_ALIVE_CSS}
</style>
</head>
<body>
<main>
<a class="logo" href="/">${logoTileLive(30)}${logoWord(22)}</a>
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
${LOGO_ALIVE_JS}
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
  // A password is an email's only (auth.ts passwordChoice): the phone form
  // and its separator step aside while one is typed.
  const codeForms = [
    methods.email
      ? `<form data-kind="email"><label for="email">${escape(t.email)}</label><input id="email" name="target" type="email" autocomplete="email" inputmode="email" required>` +
        `<div class="stack" id="password-row" hidden><label for="password">${escape(t.password)}</label><input id="password" type="password" autocomplete="current-password" maxlength="${PASSWORD_MAX}"></div></form>`
      : '',
    methods.phone
      ? `<form data-kind="phone" data-code-only><label for="phone">${escape(t.phone)}</label><input id="phone" name="target" type="tel" autocomplete="tel" inputmode="tel" placeholder="+225 07 00 00 00 00" required><p class="hint">${escape(t.phoneHint)}</p></form>`
      : '',
  ].filter(Boolean);
  const any = social || codeForms.length > 0;
  const body = `
<h1>${escape(t.heading)}</h1>
${any ? `<p>${escape(t.lead)}</p>` : `<p>${escape(t.none)}</p>`}
${social ? `<div class="stack">${social}</div>` : ''}
${social && codeForms.length ? `<div class="or">${escape(t.or)}</div>` : ''}
<div class="stack" id="ask">${codeForms.join(`<div class="or" data-code-only>${escape(t.or)}</div>`)}
${codeForms.length ? `<button class="primary" id="send" type="button">${escape(t.sendCode)}</button>` : ''}
${methods.email ? `<button class="link" type="button" id="mode">${escape(t.usePassword)}</button>
<button class="link" type="button" id="forgot" hidden>${escape(t.noPassword)}</button>` : ''}</div>
<form id="verify" class="stack" hidden>
  <p>${escape(t.codeSent)}</p>
  <label for="code">${escape(t.code)}</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
  <div class="stack" id="choose-row" hidden>
    <label for="new-password" id="choose-label">${escape(t.choosePassword)}</label>
    <input id="new-password" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}">
    <p class="hint">${escape(t.passwordHint)}</p>
  </div>
  <button class="primary" type="submit">${escape(t.signIn)}</button>
  <button class="link" type="button" id="back">${escape(t.otherMethod)}</button>
</form>
<p class="error" id="error" role="alert" hidden></p>
<div id="done" class="stack" hidden>
  <p>${escape(t.doneBody)}</p>
  <a class="link" href="/">${escape(t.home)}</a>
</div>`;
  const script = `
const t = ${JSON.stringify({ failed: t.failed, tooMany: t.tooMany, badPassword: t.badPassword, shortPassword: t.shortPassword, sendCode: t.sendCode, signIn: t.signIn, usePassword: t.usePassword, useCode: t.useCode, choosePassword: t.choosePassword, newPassword: t.newPassword })};
const MIN = ${PASSWORD_MIN};
// Opened from the app, a sign-in hands back the URL that resumes the app's
// authorization. Opened alone, there is none: say it worked, instead of
// leaving the form up for a second, refused, try (seen 01/10/2026).
function finish(data) {
  if (data && typeof data.url === "string") return follow(data);
  document.querySelector("h1").textContent = ${JSON.stringify(t.done)};
  for (const el of document.querySelectorAll("main > :not(h1):not(#done)")) el.hidden = true;
  document.getElementById("done").hidden = false;
}
const error = document.getElementById("error");
function fail(e, message) { error.textContent = message || (e && e.status === 429 ? t.tooMany : t.failed); error.hidden = false; }
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
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const chooseRow = document.getElementById("choose-row");
const newPassword = document.getElementById("new-password");
// "code": a code by email or SMS. "password": email and password.
// mustChoose: the person asked to (re)set a password, the code step requires one.
let mode = "code";
let mustChoose = false;
let signedIn = null;
function setMode(next) {
  mode = next;
  error.hidden = true;
  for (const el of document.querySelectorAll("[data-code-only]")) el.hidden = mode === "password";
  document.getElementById("password-row").hidden = mode !== "password";
  document.getElementById("forgot").hidden = mode !== "password";
  document.getElementById("mode").textContent = mode === "password" ? t.useCode : t.usePassword;
  send.textContent = mode === "password" ? t.signIn : t.sendCode;
  (mode === "password" && emailInput.value.trim() ? passwordInput : emailInput).focus();
}
async function signInWithPassword() {
  const email = emailInput.value.trim();
  if (!email || !passwordInput.value) return;
  send.disabled = true;
  try { finish(await post("/sign-in/email", { email, password: passwordInput.value })); }
  catch (e) { fail(e, e && e.status === 401 ? t.badPassword : ""); }
  send.disabled = false;
}
async function ask() {
  error.hidden = true;
  if (mode === "password") return signInWithPassword();
  const filled = [...document.querySelectorAll("form[data-kind]")].find((f) => !f.hidden && f.elements.target.value.trim());
  if (!filled) return;
  const id = filled.elements.target.value.trim();
  target = { kind: filled.dataset.kind, id: filled.dataset.kind === "phone" ? id.replace(/[\\s.-]/g, "") : id };
  send.disabled = true;
  try {
    if (target.kind === "email") await post("/email-otp/send-verification-otp", { email: target.id, type: "sign-in" });
    else await post("/phone-number/send-otp", { phoneNumber: target.id });
    document.getElementById("ask").hidden = true;
    // With an email, the code step may set a password too: optional, or
    // required when that is what the person came for.
    if (chooseRow) {
      chooseRow.hidden = target.kind !== "email";
      document.getElementById("choose-label").textContent = mustChoose ? t.newPassword : t.choosePassword;
      newPassword.required = mustChoose;
    }
    verify.hidden = false;
    document.getElementById("code").focus();
  } catch (e) { fail(e); }
  send.disabled = false;
}
if (document.getElementById("mode")) {
  document.getElementById("mode").addEventListener("click", () => { mustChoose = false; setMode(mode === "password" ? "code" : "password"); });
  document.getElementById("forgot").addEventListener("click", () => { mustChoose = true; setMode("code"); if (emailInput.value.trim()) ask(); });
}
if (send) send.addEventListener("click", ask);
for (const f of document.querySelectorAll("form[data-kind]")) f.addEventListener("submit", (e) => { e.preventDefault(); ask(); });
verify.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const code = document.getElementById("code").value.trim();
  const chosen = target.kind === "email" && newPassword ? newPassword.value : "";
  if (chosen && chosen.length < MIN) return fail(null, t.shortPassword);
  try {
    // Signed in once: a password that failed to save is retried, not the code.
    signedIn = signedIn || (target.kind === "email"
      ? await post("/sign-in/email-otp", { email: target.id, otp: code })
      : await post("/phone-number/verify", { phoneNumber: target.id, code }));
    if (chosen) await post("/password/choose", { password: chosen });
    finish(signedIn);
  } catch (err) { fail(err); }
});
document.getElementById("back").addEventListener("click", () => {
  verify.hidden = true;
  mustChoose = false;
  signedIn = null;
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
