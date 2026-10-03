// The sign-in and consent pages the OAuth server sends the app to
// (architecture §3.5 "Comptes et connexion"). Server-rendered, no framework,
// nothing loaded from elsewhere: they must work on a slow phone connection.
// Strings live in STRINGS until @baarali/i18n exists (roadmap phase 1).

import { PASSWORD_MAX, PASSWORD_MIN } from './password-limits.js';
import { DUO_CSS, DUO_JS, duoStage } from './sign-in-duo.js';
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
    heading: 'Content de vous revoir',
    lead: 'Connectez-vous, ou créez votre compte : c’est gratuit.',
    emailPlaceholder: 'nom@exemple.com',
    passwordPlaceholder: '8 caractères au moins',
    // The two above the form (sign-in-duo.ts): [first, second] voice.
    duo: {
      hello: ['Bonjour 👋', 'On vous attendait'],
      emailEmpty: ['Ah, vous revoilà !', 'Allez-y, on regarde 👀'],
      noAt: ['Hmm, il est où le @ ?', 'Une adresse en a toujours un, comme nom@exemple.com'],
      noEnd: ['Presque…', 'Il manque la fin, comme .com ou .ci'],
      emailOk: 'Ça, c’est une vraie adresse ! ✓',
      thenCode: 'Cliquez, on vous envoie un code ✉️',
      thenPassword: 'Le mot de passe, maintenant 🔐',
      notLooking: ['On ne regarde pas 🙈', 'Promis, les yeux fermés'],
      more: ['Encore $n caractère', 'Encore $n caractères'],
      atLeast: '8 au moins, continuez !',
      passwordOk: ['Parfait 👍', 'Appuyez sur Se connecter 🙌'],
      wrongPassword: ['Hmm, ça ne correspond pas', 'Vérifiez l’adresse, ou recevez un code à la place'],
      phoneEmpty: ['Votre numéro ?', 'Avec l’indicatif, comme +225 07…'],
      phonePrefix: ['Il manque l’indicatif', 'Commencez par +, comme +226 ou +225'],
      phoneOk: ['Bon numéro ✓', 'Cliquez, on vous envoie un code par SMS 📱'],
      sentEmail: ['Le code est parti ✉️', 'Regardez vos emails, même les indésirables'],
      sentSms: ['Le code est parti 📱', 'Il arrive par SMS'],
      digits: ['Encore $n chiffre', 'Encore $n chiffres'],
      codeOk: ['Les 6 y sont 👍', 'Appuyez sur Se connecter'],
      wrongCode: ['Ce code ne marche pas', 'Il vaut 5 minutes. Besoin d’un autre ? Utilisez un autre moyen.'],
      forgot: ['Pas de souci', 'Un code d’abord, puis vous choisissez votre mot de passe'],
      choose: ['Choisissez-en un bon 🔐', '8 caractères au moins, on ne regarde pas'],
      chooseShort: ['Un peu court', '8 caractères au moins pour le mot de passe'],
      tooMany: ['Doucement 😅', 'Trop d’essais : patientez une minute'],
      failed: ['Ça n’a pas marché', 'Vérifiez votre connexion et réessayez'],
      done: ['Bienvenue ! 🎉', 'On vous ramène dans l’app'],
    },
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
    accountTitle: 'Continuer avec ce compte ?',
    accountBody: 'Vous êtes connecté en tant que',
    continueAs: 'Continuer',
    switchAccount: 'Changer de compte',
    doneBody: 'Votre compte Baarali est prêt. Ouvrez l’application Baarali pour continuer.',
  },
  en: {
    title: 'Sign in to Baarali',
    heading: 'Good to see you',
    lead: 'Sign in, or create your account: it is free.',
    emailPlaceholder: 'name@example.com',
    passwordPlaceholder: '8 characters at least',
    duo: {
      hello: ['Hello 👋', 'We were waiting for you'],
      emailEmpty: ['Oh, it’s you!', 'Type away, we’re watching 👀'],
      noAt: ['Hmm, where’s the @?', 'Emails always have one, like name@example.com'],
      noEnd: ['Almost…', 'The end is missing, like .com'],
      emailOk: 'That’s a real email! ✓',
      thenCode: 'Click, we’ll send you a code ✉️',
      thenPassword: 'Password next 🔐',
      notLooking: ['We’re not looking 🙈', 'Promise, eyes closed'],
      more: ['$n more character', '$n more characters'],
      atLeast: '8 at least, keep going!',
      passwordOk: ['Perfect 👍', 'Hit Sign in 🙌'],
      wrongPassword: ['Hmm, that doesn’t match', 'Check the email, or get a code instead'],
      phoneEmpty: ['Your number?', 'With the country code, like +225 07…'],
      phonePrefix: ['The country code is missing', 'Start with +, like +226 or +225'],
      phoneOk: ['Good number ✓', 'Click, we’ll text you a code 📱'],
      sentEmail: ['Code sent ✉️', 'Check your inbox, spam included'],
      sentSms: ['Code sent 📱', 'It comes by text message'],
      digits: ['$n more digit', '$n more digits'],
      codeOk: ['All 6 are there 👍', 'Hit Sign in'],
      wrongCode: ['That code doesn’t work', 'It lasts 5 minutes. Need another? Use another method.'],
      forgot: ['No worries', 'A code first, then you choose your password'],
      choose: ['Pick a good one 🔐', '8 characters at least, we’re not looking'],
      chooseShort: ['A bit short', '8 characters at least for the password'],
      tooMany: ['Easy 😅', 'Too many tries: wait a minute'],
      failed: ['That didn’t work', 'Check your connection and try again'],
      done: ['Welcome! 🎉', 'Taking you back to the app'],
    },
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
    accountTitle: 'Continue with this account?',
    accountBody: 'You are signed in as',
    continueAs: 'Continue',
    switchAccount: 'Use another account',
    doneBody: 'Your Baarali account is ready. Open the Baarali app to continue.',
  },
} satisfies Record<Lang, Record<string, string | Record<string, string | string[]>>>;

const PROVIDER_NAMES: Record<string, string> = { google: 'Google', apple: 'Apple', github: 'GitHub', microsoft: 'Microsoft' };

export function pickLang(acceptLanguage: string | null): Lang {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'fr';
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(lang: Lang, title: string, nonce: string, body: string, script: string, extra: { header?: string; css?: string; js?: string } = {}): string {
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
/* Said by the two above the form; kept for a screen reader. */
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.lead { text-align:center; margin-top:-8px; }
${extra.header ? 'h1 { text-align:center; }' : ''}
${LOGO_ALIVE_CSS}
${extra.css ?? ''}
</style>
</head>
<body>
<main>
${extra.header ?? `<a class="logo" href="/">${logoTileLive(30)}${logoWord(22)}</a>`}
${body}
</main>
<script nonce="${nonce}">
"use strict";
// Better Auth signs the authorization request into this page's query; it
// comes back with every call so the flow resumes once the person is in.
const oauthQuery = location.search.slice(1);
// The admin console sends people here with #admin: a fragment, since the
// query is the signed authorization request and anything else in it is refused.
const forAdmin = location.hash === "#admin";
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
${extra.js ?? ''}
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
      ? `<form data-kind="email"><label for="email">${escape(t.email)}</label><input id="email" name="target" type="email" autocomplete="email" inputmode="email" placeholder="${escape(t.emailPlaceholder)}" required>` +
        `<div class="stack" id="password-row" hidden><label for="password">${escape(t.password)}</label><input id="password" type="password" autocomplete="current-password" maxlength="${PASSWORD_MAX}" placeholder="${escape(t.passwordPlaceholder)}"></div></form>`
      : '',
    methods.phone
      ? `<form data-kind="phone" data-code-only><label for="phone">${escape(t.phone)}</label><input id="phone" name="target" type="tel" autocomplete="tel" inputmode="tel" placeholder="+225 07 00 00 00 00" required><p class="hint">${escape(t.phoneHint)}</p></form>`
      : '',
  ].filter(Boolean);
  const any = social || codeForms.length > 0;
  const body = `
<h1>${escape(t.heading)}</h1>
${any ? `<p class="lead">${escape(t.lead)}</p>` : `<p class="lead">${escape(t.none)}</p>`}
${social ? `<div class="stack">${social}</div>` : ''}
${social && codeForms.length ? `<div class="or">${escape(t.or)}</div>` : ''}
<div class="stack" id="ask">${codeForms.join(`<div class="or" data-code-only>${escape(t.or)}</div>`)}
${codeForms.length ? `<button class="primary" id="send" type="button" disabled>${escape(t.sendCode)}</button>` : ''}
${methods.email ? `<button class="link" type="button" id="mode">${escape(t.usePassword)}</button>
<button class="link" type="button" id="forgot" hidden>${escape(t.noPassword)}</button>` : ''}</div>
<form id="verify" class="stack" hidden>
  <p>${escape(t.codeSent)}</p>
  <label for="code">${escape(t.code)}</label>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="••••••" required>
  <div class="stack" id="choose-row" hidden>
    <label for="new-password" id="choose-label">${escape(t.choosePassword)}</label>
    <input id="new-password" type="password" autocomplete="new-password" maxlength="${PASSWORD_MAX}">
    <p class="hint">${escape(t.passwordHint)}</p>
  </div>
  <button class="primary" id="check" type="submit" disabled>${escape(t.signIn)}</button>
  <button class="link" type="button" id="back">${escape(t.otherMethod)}</button>
</form>
<p class="sr" id="error" role="alert"></p>
<div id="done" class="stack" hidden>
  <p>${escape(t.doneBody)}</p>
</div>`;
  const script = `
const t = ${JSON.stringify({ failed: t.failed, tooMany: t.tooMany, badPassword: t.badPassword, shortPassword: t.shortPassword, sendCode: t.sendCode, signIn: t.signIn, usePassword: t.usePassword, useCode: t.useCode, choosePassword: t.choosePassword, newPassword: t.newPassword, done: t.done })};
const s = ${JSON.stringify(t.duo)};
const MIN = ${PASSWORD_MIN};
// The two of them (sign-in-duo.ts) say each step, and each error, aloud;
// the hidden #error says it again for a screen reader.
const duo = window.duo || { say() {}, act() {}, shut() {}, watch() {} };
const plural = (n, one, many) => (n > 1 ? many : one).replace("$n", n);
// Opened from the app, a sign-in hands back the URL that resumes the app's
// authorization. Opened alone, there is none: say it worked, instead of
// leaving the form up for a second, refused, try (seen 01/10/2026).
function finish(data) {
  duo.act("nod");
  duo.say(s.done[0], s.done[1]);
  if (data && typeof data.url === "string") return setTimeout(() => follow(data), 900);
  // Opened by the admin console (/admin): back to it once signed in.
  if (forAdmin) return setTimeout(() => location.assign("/admin"), 600);
  document.querySelector("h1").textContent = t.done;
  for (const el of document.querySelectorAll("main > :not(h1):not(#done):not(.duo-stage)")) el.hidden = true;
  document.getElementById("done").hidden = false;
}
const error = document.getElementById("error");
// A refusal: the two say what to do, with a shake.
function fail(e, line) {
  const said = line || (e && e.status === 429 ? s.tooMany : s.failed);
  error.textContent = said.join(" ");
  duo.act("shake");
  duo.say(said[0], said[1], { err: true });
}
for (const b of document.querySelectorAll("[data-provider]")) {
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { follow(await post("/sign-in/social", { provider: b.dataset.provider, callbackURL: forAdmin ? "/admin" : "/auth/v1/sign-in" })); }
    catch (e) { fail(e); b.disabled = false; }
  });
}
let target = null;
const send = document.getElementById("send");
const verify = document.getElementById("verify");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const passwordInput = document.getElementById("password");
const chooseRow = document.getElementById("choose-row");
const newPassword = document.getElementById("new-password");
const codeInput = document.getElementById("code");
const check = document.getElementById("check");
// "code": a code by email or SMS. "password": email and password.
// mustChoose: the person asked to (re)set a password, the code step requires one.
let mode = "code";
let mustChoose = false;
let signedIn = null;
const emailOk = (v) => /^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$/i.test(v);
const phoneOk = (v) => /^\\+[1-9][\\d\\s.-]{7,18}$/.test(v);
function ready() {
  if (!send) return;
  const email = emailInput ? emailInput.value.trim() : "";
  const phone = phoneInput && mode === "code" ? phoneInput.value.trim() : "";
  send.disabled = mode === "password"
    ? !(emailOk(email) && passwordInput.value.length >= MIN)
    : !(emailOk(email) || phoneOk(phone));
}
function onEmail() {
  const v = emailInput.value.trim();
  duo.watch(emailInput);
  if (!v) duo.say(s.emailEmpty[0], s.emailEmpty[1]);
  else if (!v.includes("@")) duo.say(s.noAt[0], s.noAt[1]);
  else if (!emailOk(v)) duo.say(s.noEnd[0], s.noEnd[1]);
  else duo.say(s.emailOk, mode === "password" ? s.thenPassword : s.thenCode);
  ready();
}
function onPassword() {
  const v = passwordInput.value;
  if (!v) duo.say(s.notLooking[0], s.notLooking[1]);
  else if (v.length < MIN) duo.say(plural(MIN - v.length, s.more[0], s.more[1]), s.atLeast);
  else duo.say(s.passwordOk[0], s.passwordOk[1]);
  ready();
}
function onPhone() {
  const v = phoneInput.value.trim();
  duo.watch(phoneInput);
  if (!v) duo.say(s.phoneEmpty[0], s.phoneEmpty[1]);
  else if (!v.startsWith("+")) duo.say(s.phonePrefix[0], s.phonePrefix[1]);
  else if (phoneOk(v)) duo.say(s.phoneOk[0], s.phoneOk[1]);
  ready();
}
if (emailInput) { emailInput.addEventListener("focus", onEmail); emailInput.addEventListener("input", onEmail); }
if (phoneInput) { phoneInput.addEventListener("focus", onPhone); phoneInput.addEventListener("input", onPhone); }
if (passwordInput) {
  passwordInput.addEventListener("focus", () => { duo.shut(true); onPassword(); });
  passwordInput.addEventListener("blur", () => duo.shut(false));
  passwordInput.addEventListener("input", onPassword);
}
function setMode(next) {
  mode = next;
  error.textContent = "";
  for (const el of document.querySelectorAll("[data-code-only]")) el.hidden = mode === "password";
  document.getElementById("password-row").hidden = mode !== "password";
  document.getElementById("forgot").hidden = mode !== "password";
  document.getElementById("mode").textContent = mode === "password" ? t.useCode : t.usePassword;
  send.textContent = mode === "password" ? t.signIn : t.sendCode;
  (mode === "password" && emailOk(emailInput.value.trim()) ? passwordInput : emailInput).focus();
  ready();
}
async function signInWithPassword() {
  const email = emailInput.value.trim();
  if (!emailOk(email) || passwordInput.value.length < MIN) return;
  send.disabled = true;
  try { finish(await post("/sign-in/email", { email, password: passwordInput.value })); }
  catch (e) { fail(e, e && e.status === 401 ? s.wrongPassword : null); ready(); }
}
async function ask() {
  error.textContent = "";
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
    codeInput.focus();
    duo.act("hop");
    const sent = target.kind === "email" ? s.sentEmail : s.sentSms;
    duo.say(sent[0], sent[1]);
  } catch (e) { fail(e); }
  ready();
}
if (send) send.addEventListener("click", ask);
for (const f of document.querySelectorAll("form[data-kind]")) f.addEventListener("submit", (e) => { e.preventDefault(); ask(); });
if (document.getElementById("mode")) {
  document.getElementById("mode").addEventListener("click", () => { mustChoose = false; setMode(mode === "password" ? "code" : "password"); });
  document.getElementById("forgot").addEventListener("click", () => {
    mustChoose = true;
    setMode("code");
    duo.say(s.forgot[0], s.forgot[1]);
    if (emailOk(emailInput.value.trim())) ask();
  });
}
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\\D/g, "").slice(0, 6);
  duo.watch(codeInput);
  const left = 6 - codeInput.value.length;
  check.disabled = left > 0;
  if (left > 0 && left < 6) duo.say(plural(left, s.digits[0], s.digits[1]), "");
  else if (left === 0) duo.say(s.codeOk[0], s.codeOk[1]);
});
if (newPassword) {
  newPassword.addEventListener("focus", () => { duo.shut(true); duo.say(s.choose[0], s.choose[1]); });
  newPassword.addEventListener("blur", () => duo.shut(false));
}
verify.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  const code = codeInput.value.trim();
  const chosen = target.kind === "email" && newPassword ? newPassword.value : "";
  if (chosen && chosen.length < MIN) return fail(null, s.chooseShort);
  check.disabled = true;
  try {
    // Signed in once: a password that failed to save is retried, not the code.
    try {
      signedIn = signedIn || (target.kind === "email"
        ? await post("/sign-in/email-otp", { email: target.id, otp: code })
        : await post("/phone-number/verify", { phoneNumber: target.id, code }));
    } catch (err) { throw Object.assign(err, { wrongCode: err.status >= 400 && err.status < 429 }); }
    if (chosen) await post("/password/choose", { password: chosen });
    finish(signedIn);
  } catch (err) {
    fail(err, err && err.wrongCode ? s.wrongCode : null);
    check.disabled = codeInput.value.length !== 6;
  }
});
document.getElementById("back").addEventListener("click", () => {
  verify.hidden = true;
  mustChoose = false;
  signedIn = null;
  document.getElementById("ask").hidden = false;
  if (emailInput) emailInput.focus();
});
setTimeout(() => duo.say(s.hello[0], s.hello[1]), 500);`;
  return layout(lang, t.title, opts.nonce, body, script, { header: duoStage(), css: DUO_CSS, js: DUO_JS });
}

/**
 * Shown when the app asks to sign in while this browser already holds a
 * session (03/10/2026): before, the app was signed in to that account
 * without a word, and nobody could pick another one.
 */
export function selectAccountPage(opts: { who: string; lang: string | null; nonce: string }): string {
  const lang = pickLang(opts.lang);
  const t = STRINGS[lang];
  const body = `
<h1>${escape(t.accountTitle)}</h1>
<p>${escape(t.accountBody)} <strong>${escape(opts.who)}</strong></p>
<div class="stack">
  <button class="primary" id="continue" type="button">${escape(t.continueAs)}</button>
  <button id="switch" type="button">${escape(t.switchAccount)}</button>
</div>
<p class="error" id="error" role="alert" hidden></p>`;
  const script = `
const error = document.getElementById("error");
const failed = () => { error.textContent = ${JSON.stringify(t.failed)}; error.hidden = false; };
document.getElementById("continue").addEventListener("click", async () => {
  try { follow(await post("/oauth2/continue", { selected: true })); } catch { failed(); }
});
// Signed out, then the sign-in page with the same signed request: the app
// gets whichever account signs in there.
document.getElementById("switch").addEventListener("click", async () => {
  try {
    const res = await fetch("/auth/v1/sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error("failed");
    location.assign("/auth/v1/sign-in?" + oauthQuery);
  } catch { failed(); }
});`;
  return layout(lang, t.accountTitle, opts.nonce, body, script);
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
