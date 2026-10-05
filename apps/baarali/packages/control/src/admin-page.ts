// The admin console's page (decided 03/10/2026, mockup validated the same
// day). Server-rendered shell, then its own script reads /admin/api. Like
// the sign-in pages: nothing loaded from elsewhere, a nonce for the script
// and the style. French only: the console is the owner's.

import { FAVICON, logoTile } from './logo.js';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const CSS = `
@font-face { font-family:"Inter"; src:url(/assets/inter.woff2) format("woff2"); font-weight:400 800; font-display:swap; }
@font-face { font-family:"Source Serif 4"; src:url(/assets/source-serif-4.woff2) format("woff2"); font-weight:400 700; font-display:swap; }
:root { --paper:#ffffff; --mist:#f5f5f5; --line:#e7e7e7; --ink:#0d0d0d; --text:#2b2b2b; --muted:#5d5d5d; --blue:#1a6dff; --blue-soft:#eef3ff;
  --side:#fafafa; --ok:#14804a; --ok-soft:#e8f5ee; --warn:#a15c00; --warn-soft:#fff4e0; --bad:#c62828; --bad-soft:#fdecec; color-scheme:light; }
@media (prefers-color-scheme: dark) { :root { --paper:#171717; --mist:#262626; --line:#333333; --ink:#ececec; --text:#d4d4d4; --muted:#a6a6a6;
  --blue:#4d8dff; --blue-soft:#1d2738; --side:#0f0f0f; --ok:#4cc38a; --ok-soft:#173326; --warn:#f0b35a; --warn-soft:#3a2a12; --bad:#ff7b7b; --bad-soft:#3d1c1c; color-scheme:dark; } }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
body { margin:0; background:var(--paper); color:var(--text); font:14px/1.5 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
.shell { display:grid; grid-template-columns:220px 1fr; min-height:100svh; }
aside { background:var(--side); border-right:1px solid var(--line); padding:18px 12px; display:flex; flex-direction:column; gap:4px; }
.brand { display:flex; align-items:center; gap:8px; padding:0 8px 18px; font-weight:700; color:var(--ink); }
.brand small { font-weight:500; color:var(--muted); font-size:12px; margin-left:auto; border:1px solid var(--line); border-radius:6px; padding:0 6px; }
nav button { all:unset; cursor:pointer; display:flex; gap:10px; align-items:center; padding:7px 10px; border-radius:8px; color:var(--text); width:100%; box-sizing:border-box; }
nav button:hover, nav button[aria-current="true"] { background:var(--mist); }
nav button[aria-current="true"] { color:var(--ink); font-weight:500; }
nav .count { margin-left:auto; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
nav h6 { margin:14px 10px 4px; font:500 11px "Inter", sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
.who { margin-top:auto; padding:10px; font-size:12px; color:var(--muted); border-top:1px solid var(--line); overflow-wrap:anywhere; }
main { padding:28px 32px 60px; min-width:0; }
.head { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
h1 { font:600 26px/1.2 "Source Serif 4", Georgia, serif; color:var(--ink); margin:0; text-wrap:balance; }
.head p { margin:4px 0 0; color:var(--muted); }
.head .actions { margin-left:auto; display:flex; gap:8px; align-items:center; }
.btn { font:inherit; cursor:pointer; padding:7px 12px; border-radius:8px; border:1px solid var(--line); background:transparent; font-weight:500; color:var(--ink); font-size:13px; }
.btn:hover { background:var(--mist); }
.btn:disabled { opacity:.5; cursor:default; }
.btn.primary { background:var(--blue); border-color:var(--blue); color:#fff; }
.btn.danger { color:var(--bad); }
a.btn { text-decoration:none; display:inline-block; }
.stats { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; margin-bottom:24px; }
.stat { border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.stat b { display:block; font:600 24px "Source Serif 4", Georgia, serif; color:var(--ink); font-variant-numeric:tabular-nums; }
.stat span { color:var(--muted); font-size:12px; }
.grid2 { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:16px; }
section.card { border:1px solid var(--line); border-radius:12px; padding:16px; min-width:0; }
section.card h2 { font:600 14px "Inter", sans-serif; color:var(--ink); margin:0 0 12px; }
.tablewrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
th { text-align:left; font:500 11px "Inter", sans-serif; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }
td { padding:10px; border-bottom:1px solid var(--line); white-space:nowrap; }
tr.row { cursor:pointer; }
tr.row:hover td { background:var(--mist); }
td.num { text-align:right; }
.pill { display:inline-block; font-size:12px; padding:1px 8px; border-radius:99px; background:var(--mist); color:var(--text); }
.pill.blue { background:var(--blue-soft); color:var(--blue); }
.pill.ok { background:var(--ok-soft); color:var(--ok); }
.pill.warn { background:var(--warn-soft); color:var(--warn); }
.pill.bad { background:var(--bad-soft); color:var(--bad); }
.pill.tag { margin-left:8px; }
progress { width:90px; height:6px; vertical-align:middle; margin-right:6px; appearance:none; border:none; border-radius:9px; background:var(--mist); overflow:hidden; }
progress::-webkit-progress-bar { background:var(--mist); border-radius:9px; }
progress::-webkit-progress-value { background:var(--blue); border-radius:9px; }
progress::-moz-progress-bar { background:var(--blue); }
progress.hot::-webkit-progress-value { background:var(--warn); }
progress.hot::-moz-progress-bar { background:var(--warn); }
.toolbar { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center; }
input, select { font:inherit; font-size:16px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }
@media (min-width:821px) { input, select { font-size:14px; } }
input[type=search] { flex:1; min-width:180px; }
.list { display:flex; flex-direction:column; }
.it { display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--line); }
.it:last-child { border-bottom:0; }
.it time { font-size:12px; color:var(--muted); white-space:nowrap; min-width:110px; font-variant-numeric:tabular-nums; }
.it p { margin:0; }
.it small, .muted { color:var(--muted); }
.empty { color:var(--muted); padding:8px 0; }
.drawer { position:fixed; inset:0 0 0 auto; width:min(480px,100%); background:var(--paper); border-left:1px solid var(--line); box-shadow:-20px 0 40px rgb(0 0 0 / .15); padding:24px; overflow:auto; z-index:5; }
.drawer h3 { font:600 20px "Source Serif 4", Georgia, serif; color:var(--ink); margin:0 90px 4px 0; overflow-wrap:anywhere; }
.drawer .close { position:absolute; right:18px; top:18px; }
.kv { display:grid; grid-template-columns:140px 1fr; gap:8px 12px; margin:16px 0; font-size:13px; }
.kv dt { color:var(--muted); }
.kv dd { margin:0; color:var(--ink); font-variant-numeric:tabular-nums; }
.sub { font:500 11px "Inter", sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin:20px 0 8px; }
.toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:var(--ink); color:var(--paper); padding:8px 14px; border-radius:10px; font-size:13px; z-index:9; }
.code { font:500 13px ui-monospace, Menlo, monospace; color:var(--ink); background:var(--mist); padding:1px 6px; border-radius:5px; }
.tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:16px; flex-wrap:wrap; }
.tabs button { all:unset; cursor:pointer; padding:8px 12px; color:var(--muted); border-bottom:2px solid transparent; margin-bottom:-1px; }
.tabs button[aria-selected="true"] { color:var(--ink); border-color:var(--ink); font-weight:500; }
.vendor { border:1px solid var(--line); border-radius:12px; margin-bottom:10px; overflow:hidden; }
.vendor > header { display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:pointer; flex-wrap:wrap; }
.vendor > header:hover { background:var(--mist); }
.vendor > header b { color:var(--ink); }
.vendor > header .right { margin-left:auto; }
.mrow { display:flex; align-items:center; gap:10px; padding:8px 14px; border-top:1px solid var(--line); flex-wrap:wrap; }
.mrow .nm { flex:1; min-width:180px; }
.mrow .nm b { display:block; color:var(--ink); font-weight:500; }
.mrow .nm small { color:var(--muted); font:12px ui-monospace, Menlo, monospace; overflow-wrap:anywhere; }
.mrow select { padding:4px 8px; font-size:12px; }
.sw { width:30px; height:18px; border-radius:99px; background:var(--line); position:relative; flex:none; cursor:pointer; border:0; padding:0; }
.sw::after { content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#fff; transition:left .15s; }
.sw[aria-pressed="true"] { background:var(--blue); }
.sw[aria-pressed="true"]::after { left:14px; }
.star { all:unset; cursor:pointer; color:var(--line); font-size:16px; width:18px; text-align:center; }
.star[aria-pressed="true"] { color:var(--warn); }
.picker { border:1px solid var(--line); border-radius:14px; background:var(--paper); box-shadow:0 12px 32px rgb(0 0 0 / .12); padding:6px; max-height:520px; overflow:auto; }
.picker .ttl { font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); padding:6px 10px; }
.picker .grp { position:sticky; top:-6px; background:var(--paper); font-size:11px; font-weight:600; color:var(--muted); padding:8px 10px 4px; }
.picker .opt { display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:10px; }
.picker .opt.locked { opacity:.5; }
.picker .opt b { display:block; color:var(--ink); font-weight:600; font-size:13px; }
.picker .opt small { display:block; color:var(--muted); font-size:11px; }
.picker .opt .pill { margin-left:auto; }
.sticky { position:sticky; top:16px; align-self:start; }
.order { display:flex; gap:4px; margin-left:auto; }
.toolbar.spaced { margin-top:12px; }
.grow { flex:1; }
.nowrap { white-space:nowrap; }
.push { margin-left:auto; }
.picker .opt .mark { width:16px; flex:none; }
@media (max-width:820px) {
  .shell { grid-template-columns:minmax(0,1fr); }
  aside { border-right:0; border-bottom:1px solid var(--line); flex-direction:row; flex-wrap:wrap; padding:12px 16px; }
  .brand { width:100%; padding:0 8px 8px; }
  nav { display:flex; flex-wrap:wrap; gap:4px; }
  nav h6, .who { display:none; }
  nav button { width:auto; }
  main { padding:20px 16px 48px; }
  .stats { grid-template-columns:repeat(2, minmax(0,1fr)); }
  .grid2 { grid-template-columns:1fr; }
}`;

function shell(nonce: string, title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<link rel="icon" href="${FAVICON}">
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
${body}
${script ? `<script nonce="${nonce}">\n"use strict";\n${script}\n</script>` : ''}
</body>
</html>`;
}

/** Signed in, but not as an admin: say so, and offer another account. */
export function deniedPage(opts: { nonce: string; who: string | null }): string {
  const body = `
<main>
  <div class="head"><div><h1>Accès réservé</h1>
  <p>${opts.who ? `Le compte <strong>${escape(opts.who)}</strong> n'a pas accès à la console.` : "Ce compte n'a pas accès à la console."}</p></div></div>
  <button class="btn primary" id="switch" type="button">Changer de compte</button>
</main>`;
  const script = `
document.getElementById("switch").addEventListener("click", async () => {
  await fetch("/auth/v1/sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  location.assign("/auth/v1/sign-in#admin");
});`;
  return shell(opts.nonce, 'Console Baarali', body, script);
}

export function adminPage(opts: { nonce: string; admin: string }): string {
  const body = `
<div class="shell">
<aside>
  <div class="brand">${logoTile(24)}Baarali <small>Admin</small></div>
  <nav id="nav">
    <h6>Piloter</h6>
    <button data-v="apercu" aria-current="true">Vue d'ensemble</button>
    <button data-v="clients">Clients <span class="count" id="n-clients"></span></button>
    <button data-v="instances">Instances <span class="count" id="n-instances"></span></button>
    <button data-v="modeles">Modèles <span class="count" id="n-models"></span></button>
    <h6>Garder la trace</h6>
    <button data-v="journal">Journal</button>
  </nav>
  <div class="who">Connecté : ${escape(opts.admin)}<br><button class="btn" id="signout" type="button">Se déconnecter</button></div>
</aside>
<main>
  <div data-p="apercu">
    <div class="head"><div><h1>Vue d'ensemble</h1><p>Les 7 derniers jours</p></div>
      <div class="actions"><button class="btn" data-reload>Actualiser</button></div></div>
    <div class="stats" id="stats"></div>
    <div class="grid2">
      <section class="card"><h2>Ce qui demande ton attention</h2><div class="list" id="attention"></div></section>
      <section class="card"><h2>Répartition des forfaits</h2><table id="plans"></table></section>
    </div>
  </div>

  <div data-p="clients" hidden>
    <div class="head"><div><h1>Clients</h1><p>Clique sur un client pour changer son forfait ou lui offrir des crédits.</p></div>
      <div class="actions"><button class="btn" id="csv">Exporter en CSV</button></div></div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Chercher un email…">
      <select id="f-plan"><option value="">Tous les forfaits</option></select>
      <select id="f-state">
        <option value="">Toute activité</option>
        <option value="active">Actifs cette semaine</option>
        <option value="limit">Limite atteinte</option>
        <option value="idle">Inactifs depuis 14 jours</option>
        <option value="suspended">Suspendus</option>
      </select>
    </div>
    <section class="card"><div class="tablewrap"><table>
      <thead><tr><th>Client</th><th>Forfait</th><th>Session</th><th>Semaine</th><th>Crédits médias</th><th>Coût 7 j (privé)</th><th>Dernière activité</th></tr></thead>
      <tbody id="clients"></tbody>
    </table></div></section>
  </div>

  <div data-p="instances" hidden>
    <div class="head"><div><h1>Instances</h1><p>Une machine par client. Elles dorment quand personne ne s'en sert.</p></div>
      <div class="actions"><span class="pill" id="current-image"></span><button class="btn" data-reload>Actualiser</button></div></div>
    <section class="card"><div class="tablewrap"><table>
      <thead><tr><th>Client</th><th>État</th><th>Version</th><th>Disque</th><th>Machine</th><th></th></tr></thead>
      <tbody id="instances"></tbody>
    </table></div></section>
  </div>

  <div data-p="modeles" hidden>
    <div class="head"><div><h1>Modèles</h1><p>Ce que tes clients peuvent choisir dans le Chat, forfait par forfait. Un changement arrive dans leur liste en moins d'une minute.</p></div>
      <div class="actions"><button class="btn" data-reload>Actualiser</button></div></div>
    <div class="tabs" id="mtabs" role="tablist">
      <button role="tab" data-t="editeurs" aria-selected="true">Par éditeur</button>
      <button role="tab" data-t="decouverte" aria-selected="false">Découverte</button>
      <button role="tab" data-t="tous" aria-selected="false" id="t-all">Tous</button>
      <button role="tab" data-t="medias" aria-selected="false">Médias · Pixazo</button>
    </div>
    <div class="grid2">
      <div>
        <div class="toolbar" id="m-filters">
          <input type="search" id="mq" placeholder="Chercher un modèle, un éditeur…">
          <select id="mf"><option value="">Tous les modèles</option><option value="open">Ouverts</option><option value="off">Masqués</option><option value="reco">Conseillés</option><option value="new">Jamais réglés</option></select>
        </div>
        <div data-tp="editeurs"><div id="vendors"></div></div>
        <div data-tp="decouverte" hidden>
          <section class="card"><h2>Les modèles du forfait gratuit</h2>
            <p class="muted" id="free-note"></p>
            <div class="list" id="free-list"></div>
            <div class="toolbar spaced"><select id="free-add" class="grow"></select><button class="btn" id="free-add-go" type="button">Ajouter</button></div>
            <div class="toolbar"><button class="btn primary" id="free-save" type="button">Enregistrer l'ordre</button></div>
          </section>
        </div>
        <div data-tp="medias" hidden>
          <p class="muted">Pixazo ne publie pas la liste de ses modèles : chacun s'ajoute dans le code (<span class="code">media.ts</span>) avec sa requête et son prix, puis apparaît ici. Ils se paient en crédits médias : tous les forfaits peuvent en ouvrir, Découverte compris.</p>
          <div id="media-models"></div>
        </div>
        <div data-tp="tous" hidden>
          <section class="card"><div class="tablewrap"><table>
            <thead><tr><th></th><th>Modèle</th><th>Éditeur</th><th>Point fort</th><th>Dès</th><th>$ / 1 M (entrée · sortie)</th></tr></thead>
            <tbody id="all-models"></tbody></table></div></section>
        </div>
      </div>
      <section class="card sticky"><h2 id="pv-title">Aperçu dans l'app <select id="pv" class="push"></select></h2>
        <div class="picker" id="picker"></div>
        <p class="muted" id="pv-note">Rangé par éditeur. Les modèles « Conseillé » passent en tête de leur éditeur ; ceux d'un forfait au-dessus restent visibles, avec un cadenas et le forfait qui les ouvre.</p>
      </section>
    </div>
  </div>

  <div data-p="journal" hidden>
    <div class="head"><div><h1>Journal</h1><p>Tout ce qui est fait depuis la console. Rien ne s'efface.</p></div></div>
    <section class="card"><div class="list" id="journal"></div></section>
  </div>
</main>
</div>

<div class="drawer" id="drawer" hidden role="dialog" aria-modal="true" aria-labelledby="d-name">
  <button class="btn close" id="close" type="button">Fermer</button>
  <h3 id="d-name"></h3>
  <p class="muted" id="d-since"></p>
  <dl class="kv" id="d-kv"></dl>
  <div class="sub">Forfait</div>
  <div class="toolbar"><select id="d-plan"></select><button class="btn primary" id="d-plan-go" type="button">Changer</button></div>
  <div class="sub">Offrir des crédits médias</div>
  <div class="toolbar">
    <select id="d-pack" aria-label="Recharge"></select>
    <input id="d-credits" type="number" min="1" max="10000" step="1" value="20" aria-label="Crédits" hidden>
    <input id="d-ref" placeholder="Référence de paiement (facultatif)" aria-label="Référence">
    <button class="btn" id="d-credits-go" type="button">Ajouter</button>
  </div>
  <div class="sub">Autres actions</div>
  <div class="toolbar">
    <button class="btn" id="d-reset" type="button">Remettre la session à zéro</button>
    <button class="btn danger" id="d-suspend" type="button"></button>
  </div>
  <div class="sub">Appareils</div>
  <div class="list" id="d-devices"></div>
  <div class="sub">Crédits médias récents</div>
  <div class="list" id="d-media"></div>
  <div class="sub">Dernières actions sur ce compte</div>
  <div class="list" id="d-log"></div>
</div>
<div class="toast" id="toast" hidden role="status"></div>`;
  return shell(opts.nonce, 'Console Baarali', body, SCRIPT);
}

// Plain DOM: text goes in with textContent, never as markup, since emails
// and references are typed by other people.
const SCRIPT = `
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid);
  return n;
};
const fr = new Intl.NumberFormat("fr-FR");
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const stamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function ago(t) {
  if (t === null) return "jamais";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return "il y a " + m + " min";
  const h = Math.round(m / 60);
  if (h < 24) return "il y a " + h + " h";
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : "il y a " + d + " jours";
}
const money = (c) => fr.format(c.xof) + " F";
function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}
async function get(path) {
  const res = await fetch("/admin/api" + path, { credentials: "same-origin" });
  if (res.status === 404) { location.assign("/admin"); throw new Error("signed out"); }
  if (!res.ok) throw new Error("failed");
  return res.json();
}
async function send(path, body = {}) {
  const res = await fetch("/admin/api" + path, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-baarali-admin": "1" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || "Ça n'a pas marché");
  return data;
}
function bar(p) {
  const n = el("progress", { max: "100", value: String(p) });
  if (p >= 90) n.className = "hot";
  return el("span", {}, n, p + " %");
}

// Navigation, remembered in the address (#clients…).
const views = ["apercu", "clients", "instances", "modeles", "journal"];
function show(v) {
  if (!views.includes(v)) v = "apercu";
  for (const s of document.querySelectorAll("[data-p]")) s.hidden = s.dataset.p !== v;
  for (const b of document.querySelectorAll("#nav button")) b.setAttribute("aria-current", String(b.dataset.v === v));
  if (location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
  load(v);
}
$("nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.v); });
for (const b of document.querySelectorAll("[data-reload]")) b.addEventListener("click", () => load(location.hash.slice(1) || "apercu"));
$("signout").addEventListener("click", async () => {
  await fetch("/auth/v1/sign-out", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  location.assign("/");
});

let clients = [];
let plans = [];
let packs = [];
async function load(v) {
  try {
    if (v === "apercu") await loadOverview();
    if (v === "clients") await loadClients();
    if (v === "instances") await loadInstances();
    if (v === "journal") await loadJournal();
    if (v === "modeles") await loadModels();
  } catch (e) { if (e.message !== "signed out") toast("Chargement impossible. Réessaie."); }
}

async function loadOverview() {
  const o = await get("/overview");
  $("n-clients").textContent = fr.format(o.clients);
  const stat = (value, label) => el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label));
  $("stats").replaceChildren(
    stat(fr.format(o.clients), "Clients · " + o.newThisWeek + " cette semaine"),
    stat(fr.format(o.activeThisWeek), "Actifs cette semaine"),
    stat(fr.format(o.paid), "Sur un forfait payant · " + fr.format(o.monthlyValueEur) + " €/mois"),
    stat(money(o.weekCost), "Coût des modèles, 7 j (privé)"),
  );
  const items = [];
  for (const i of o.attention.failedInstances) items.push(el("div", { class: "it" }, el("span", { class: "pill bad" }, "Instance"), el("p", {}, "L'instance de " + (i.email || i.id) + " est en échec", el("br"), el("small", {}, "Ouvre Instances pour la mettre à jour ou la redémarrer"))));
  for (const c of o.attention.atLimit) items.push(el("div", { class: "it" }, el("span", { class: "pill warn" }, "Limite"), el("p", {}, (c.email || c.id) + " a atteint sa limite", el("br"), el("small", {}, "Bonne occasion de proposer un forfait au-dessus"))));
  if (o.attention.outdatedInstances) items.push(el("div", { class: "it" }, el("span", { class: "pill blue" }, "Instances"), el("p", {}, o.attention.outdatedInstances + " instance(s) sur une ancienne version", el("br"), el("small", {}, "Elles passent à la nouvelle à leur prochain réveil"))));
  if (o.attention.suspended) items.push(el("div", { class: "it" }, el("span", { class: "pill bad" }, "Suspendus"), el("p", {}, o.attention.suspended + " compte(s) suspendu(s)")));
  $("attention").replaceChildren(...(items.length ? items : [el("p", { class: "empty" }, "Rien à signaler.")]));
  const max = Math.max(1, ...o.plans.map((p) => p.count));
  $("plans").replaceChildren(...o.plans.map((p) => {
    const n = el("progress", { max: String(max), value: String(p.count) });
    return el("tr", {}, el("td", {}, p.name), el("td", {}, n), el("td", { class: "num" }, String(p.count)));
  }));
}

async function loadClients() {
  const r = await get("/clients");
  clients = r.data; plans = r.plans; packs = r.packs;
  $("n-clients").textContent = fr.format(clients.length);
  const f = $("f-plan");
  if (f.options.length === 1) for (const p of plans) f.append(el("option", { value: p.id }, p.name));
  renderClients();
}
function renderClients() {
  const q = $("q").value.trim().toLowerCase();
  const plan = $("f-plan").value;
  const state = $("f-state").value;
  const week = 7 * 864e5;
  const rows = clients.filter((c) =>
    (!q || (c.email || c.id).toLowerCase().includes(q)) &&
    (!plan || c.planId === plan) &&
    (!state ||
      (state === "active" && c.lastActiveAt !== null && Date.now() - c.lastActiveAt < week) ||
      (state === "limit" && (c.week >= 100 || c.session >= 100)) ||
      (state === "idle" && (c.lastActiveAt === null || Date.now() - c.lastActiveAt > 2 * week)) ||
      (state === "suspended" && c.suspendedAt !== null)));
  $("clients").replaceChildren(...(rows.length ? rows.map((c) => el("tr", { class: "row", onclick: () => openClient(c.id) },
    el("td", {}, c.email || c.id, c.suspendedAt !== null ? el("span", { class: "pill bad tag" }, "Suspendu") : null),
    el("td", {}, el("span", { class: c.planId === "decouverte" ? "pill" : "pill blue" }, c.planName)),
    el("td", {}, bar(c.session)),
    el("td", {}, bar(c.week)),
    el("td", { class: "num" }, fr.format(c.mediaBalance)),
    el("td", { class: "num" }, money(c.cost)),
    el("td", {}, ago(c.lastActiveAt)),
  )) : [el("tr", {}, el("td", { colspan: "7", class: "empty" }, "Aucun client ne correspond."))]));
}
for (const id of ["q", "f-plan", "f-state"]) $(id).addEventListener("input", renderClients);
$("csv").addEventListener("click", () => {
  // A cell starting with = + - @ would run as a formula in a spreadsheet: an
  // email is typed by its owner, so it is defused with a leading quote.
  const cell = (v) => { let t = String(v ?? ""); if (/^[-=+@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const lines = [["email", "forfait", "inscrit le", "session %", "semaine %", "crédits médias", "coût 7 j (F CFA)", "dernière activité"].map(cell).join(";")];
  for (const c of clients) lines.push([c.email || c.id, c.planName, new Date(c.createdAt).toISOString().slice(0, 10), c.session, c.week, c.mediaBalance, c.cost.xof, c.lastActiveAt ? new Date(c.lastActiveAt).toISOString() : ""].map(cell).join(";"));
  const url = URL.createObjectURL(new Blob(["\\ufeff" + lines.join("\\n")], { type: "text/csv" }));
  el("a", { href: url, download: "clients-baarali.csv" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

let current = null;
async function openClient(id) {
  const c = await get("/clients/" + encodeURIComponent(id));
  current = c;
  if (!plans.length) { const r = await get("/clients"); plans = r.plans; packs = r.packs; }
  $("d-name").textContent = c.email || c.id;
  $("d-since").textContent = "Client depuis le " + day.format(c.createdAt) + " · dernière activité " + ago(c.lastActiveAt);
  const kv = [["Forfait", c.planName], ["Session 5 h", c.session + " %"], ["Semaine", c.week + " % · repart le " + stamp.format(c.weekResetsAt)],
    ["Crédits médias", fr.format(c.mediaBalance)], ["Coût 7 j (privé)", money(c.cost) + " · " + fr.format(c.cost.usd) + " $"],
    ["Instance", c.instance ? (c.instance.image || "?").split(":").pop() + (c.instance.managed ? "" : " · à la main") : "aucune"],
    ["État", c.suspendedAt !== null ? "Suspendu depuis le " + day.format(c.suspendedAt) : "Actif"]];
  $("d-kv").replaceChildren(...kv.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  // A pack as sold, or any amount (« Montant libre »).
  // Kept from one client to the next, once the list exists; the first pack otherwise.
  const chosen = $("d-pack").options.length ? $("d-pack").value : null;
  $("d-pack").replaceChildren(...packs.map((p) => el("option", { value: String(p.credits) }, "+" + p.credits + " (" + fr.format(p.eur) + " €)")), el("option", { value: "" }, "Montant libre…"));
  if (chosen !== null && [...$("d-pack").options].some((o) => o.value === chosen)) $("d-pack").value = chosen;
  $("d-credits").hidden = $("d-pack").value !== "";
  $("d-plan").replaceChildren(...plans.map((p) => el("option", { value: p.id }, p.name)));
  $("d-plan").value = c.planId;
  $("d-suspend").textContent = c.suspendedAt !== null ? "Rétablir le compte" : "Suspendre le compte";
  const list = (node, items, empty) => node.replaceChildren(...(items.length ? items : [el("p", { class: "empty" }, empty)]));
  list($("d-devices"), c.devices.map((d) => el("div", { class: "it" }, el("time", {}, d.lastSeenAt ? ago(d.lastSeenAt) : "jamais vu"), el("p", {}, d.name, d.revoked ? el("small", {}, " · retiré") : null))), "Aucun appareil.");
  const kind = { topup: "Recharge", charge: "Génération", refund: "Remboursement" };
  list($("d-media"), c.media.map((m) => el("div", { class: "it" }, el("time", {}, stamp.format(m.at)), el("p", {}, kind[m.kind] + " · " + (m.credits > 0 ? "+" : "") + m.credits + (m.model ? " · " + m.model : "")))), "Aucun mouvement.");
  list($("d-log"), c.journal.map((j) => el("div", { class: "it" }, el("time", {}, stamp.format(j.at)), el("p", {}, j.detail, el("br"), el("small", {}, j.actor)))), "Aucune action pour l'instant.");
  $("drawer").hidden = false;
  $("close").focus();
}
$("close").addEventListener("click", () => { $("drawer").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("drawer").hidden = true; });
async function run(button, path, body, done) {
  button.disabled = true;
  try { const r = await send("/clients/" + encodeURIComponent(current.id) + path, body); toast(done(r)); await openClient(current.id); await loadClients(); }
  catch (e) { toast(e.message); }
  finally { button.disabled = false; }
}
$("d-plan-go").addEventListener("click", (e) => run(e.currentTarget, "/plan", { plan: $("d-plan").value }, (r) => r.changed ? "Forfait changé" : "C'était déjà ce forfait"));
$("d-pack").addEventListener("change", () => { $("d-credits").hidden = $("d-pack").value !== ""; if (!$("d-credits").hidden) $("d-credits").focus(); });
$("d-credits-go").addEventListener("click", (e) => run(e.currentTarget, "/credits", { credits: Number($("d-pack").value || $("d-credits").value), reference: $("d-ref").value },
  (r) => r.duplicate ? "Cette référence a déjà été utilisée" : "+" + r.added + " crédits ajoutés"));
$("d-reset").addEventListener("click", (e) => run(e.currentTarget, "/reset-session", {}, () => "Session remise à zéro"));
$("d-suspend").addEventListener("click", (e) => run(e.currentTarget, "/suspend", { suspended: current.suspendedAt === null }, () => current.suspendedAt === null ? "Compte suspendu" : "Compte rétabli"));

const STATES = { started: ["Active", "ok"], suspended: ["Endormie", ""], stopped: ["Arrêtée", ""], starting: ["Démarre", "blue"], created: ["Créée", "blue"], failed: ["Échec", "bad"], unknown: ["Inconnu", "warn"] };
async function loadInstances() {
  const r = await get("/instances");
  $("n-instances").textContent = String(r.data.length);
  $("current-image").textContent = r.currentImage ? "Version actuelle : " + r.currentImage : "Version actuelle inconnue";
  // The button is kept: once awaited, the event no longer names it.
  const action = (i, what, label) => el("button", { class: "btn", type: "button", onclick: async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { const res = await send("/instances/" + encodeURIComponent(i.accountId) + "/" + what); toast(res.done ? label + " : fait" : "Déjà à jour"); await loadInstances(); }
    catch (err) { toast(err.message); b.disabled = false; }
  } }, label);
  $("instances").replaceChildren(...(r.data.length ? r.data.map((i) => {
    const [word, tone] = STATES[i.state] || [i.state || "Non suivie", ""];
    return el("tr", {},
      el("td", {}, i.email || i.accountId),
      el("td", {}, el("span", { class: "pill " + tone }, word)),
      el("td", {}, (i.image || "?") + (i.outdated ? " · à mettre à jour" : "")),
      el("td", {}, diskCell(i.disk, r.diskGb)),
      el("td", {}, el("span", { class: "code" }, i.machineId || i.app)),
      el("td", {}, i.managed ? el("span", { class: "toolbar" }, action(i, "wake", "Réveiller"), i.outdated ? action(i, "update", "Mettre à jour") : null, action(i, "restart", "Redémarrer"),
        i.logsUrl ? el("a", { class: "btn", href: i.logsUrl, target: "_blank", rel: "noopener noreferrer" }, "Journaux") : null) : el("small", { class: "muted" }, "déployée à la main")),
    );
  }) : [el("tr", {}, el("td", { colspan: "6", class: "empty" }, "Aucune instance."))]));
}

// Disk and backups (05/10/2026): Fly snapshots each disk once a day.
// Under 1 GB in MB, so a few files do not read as an empty disk.
const gb = (n) => (n < 1 ? fr.format(n > 0 ? Math.max(1, Math.round(n * 1000)) : 0) + " Mo" : fr.format(Math.round(n * 10) / 10) + " Go");
function diskCell(d, target) {
  if (!d) return el("small", { class: "muted" }, "—");
  const size = (d.usedGb === null ? "" : gb(d.usedGb) + " / ") + gb(d.sizeGb);
  const grows = target && d.sizeGb < target ? " · passe à " + gb(target) + " au prochain réveil" : "";
  const backups = d.backupDays === 0 ? "sans sauvegarde"
    : "sauvegardes " + (d.backupDays ?? "?") + " j" + (d.lastBackupAt ? " · dernière le " + new Date(d.lastBackupAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : " · aucune encore");
  return el("span", {}, size + grows, el("br"), el("small", { class: "muted" }, backups));
}

// Models (decided 03/10/2026): the owner's settings over OpenRouter's catalog.
let M = null;
let freeDraft = [];
const openVendors = new Set();
const strengthName = (m) => M.strengths[m.strength || m.deduced];
const usd = (n) => (n === null ? "?" : fr.format(n));
async function loadModels() {
  M = await get("/models");
  const all = M.vendors.flatMap((v) => v.models);
  $("n-models").textContent = all.filter((m) => m.enabled).length + " / " + all.length;
  $("t-all").textContent = "Tous · " + all.length;
  if (openVendors.size === 0) for (const v of M.vendors.slice(0, 2)) openVendors.add(v.id);
  freeDraft = M.free.slice();
  const pv = $("pv");
  if (!pv.options.length) for (const p of M.plans) pv.append(el("option", { value: p.id }, p.name));
  renderModels();
  await loadPreview();
}
function keep(m) {
  const q = $("mq").value.trim().toLowerCase();
  const f = $("mf").value;
  return (!q || (m.name + " " + m.id).toLowerCase().includes(q)) &&
    (!f || (f === "open" && m.enabled) || (f === "off" && !m.enabled) || (f === "reco" && m.recommended) || (f === "new" && !m.configured));
}
async function setModels(ids, set, done) {
  try { await send("/models", { ids, set }); toast(done); await loadModels(); }
  catch (e) { toast(e.message); }
}
function paidPlans() { return M.plans.filter((p) => !p.free); }
function modelRow(m) {
  const sw = el("button", { class: "sw", type: "button", "aria-pressed": String(m.enabled), title: m.enabled ? "Visible chez les clients : cliquer pour masquer" : "Masqué : cliquer pour l'ouvrir",
    onclick: () => setModels([m.id], { enabled: !m.enabled }, m.enabled ? "Modèle masqué" : "Modèle ouvert") });
  const star = el("button", { class: "star", type: "button", "aria-pressed": String(m.recommended), title: "Conseillé : passe en tête de son éditeur",
    onclick: () => setModels([m.id], { recommended: !m.recommended }, m.recommended ? "Plus conseillé" : "Conseillé") }, "★");
  const strength = el("select", { title: "Point fort, écrit sous le nom", onchange: (e) => setModels([m.id], { strength: e.target.value || null }, "Point fort changé") },
    el("option", { value: "" }, M.strengths[m.deduced] + " (auto)"),
    ...Object.entries(M.strengths).map(([k, v]) => el("option", { value: k }, v)));
  strength.value = m.strength || "";
  const plans = paidPlans();
  const min = el("select", { title: "Le forfait qui l'ouvre", onchange: (e) => setModels([m.id], { minPlan: e.target.value || null }, "Forfait changé") },
    ...plans.map((p, i) => el("option", { value: i === 0 ? "" : p.id }, "dès " + p.name)));
  min.value = m.minPlan && m.minPlan !== plans[0].id ? m.minPlan : "";
  const free = m.free >= 0 ? el("span", { class: "pill ok" }, "Découverte") : null;
  return el("div", { class: "mrow" }, sw, star,
    el("span", { class: "nm" }, el("b", {}, m.name, " ", free), el("small", {}, m.id + " · ", el("span", { class: "nowrap" }, usd(m.price.prompt) + " $ / " + usd(m.price.completion) + " $"))),
    strength, min);
}
function renderModels() {
  $("vendors").replaceChildren(...M.vendors.map((v) => {
    const shown = v.models.filter(keep);
    if (!shown.length) return null;
    const on = v.models.filter((m) => m.enabled).length;
    const allOn = on === v.models.length;
    const searching = $("mq").value.trim() !== "" || $("mf").value !== "";
    const expanded = searching || openVendors.has(v.id);
    const header = el("header", { onclick: (e) => { if (e.target.closest("button")) return; if (openVendors.has(v.id)) openVendors.delete(v.id); else openVendors.add(v.id); renderModels(); } },
      el("b", {}, v.name), el("span", { class: "muted" }, on + " / " + v.models.length + " ouverts"),
      el("span", { class: "right" }, el("button", { class: "btn", type: "button",
        onclick: () => setModels(v.models.map((m) => m.id), { enabled: !allOn }, (allOn ? "Masqués : " : "Ouverts : ") + v.name) }, allOn ? "Tout masquer" : "Tout ouvrir")));
    return el("div", { class: "vendor" }, header, expanded ? el("div", {}, ...shown.map(modelRow)) : null);
  }).filter(Boolean));
  const plans = paidPlans();
  const all = M.vendors.flatMap((v) => v.models.map((m) => ({ ...m, vendor: v.name }))).filter(keep);
  $("all-models").replaceChildren(...all.map((m) => el("tr", {},
    el("td", {}, el("button", { class: "sw", type: "button", "aria-pressed": String(m.enabled), onclick: () => setModels([m.id], { enabled: !m.enabled }, m.enabled ? "Modèle masqué" : "Modèle ouvert") })),
    el("td", {}, m.name), el("td", {}, m.vendor), el("td", {}, strengthName(m)),
    el("td", {}, (plans.find((p) => p.id === m.minPlan) || plans[0]).name),
    el("td", { class: "num" }, usd(m.price.prompt) + " · " + usd(m.price.completion)))));
  renderFree();
}
function renderFree() {
  const byId = new Map(M.vendors.flatMap((v) => v.models).map((m) => [m.id, m]));
  $("free-note").textContent = (M.freeFromCode ? "La liste du code, tant que tu n'en as pas enregistré une. " : "") +
    "Le premier est celui par défaut ; les suivants prennent le relais s'il ne répond pas. Choisis des modèles économiques : le budget gratuit est petit.";
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= freeDraft.length) return; [freeDraft[i], freeDraft[j]] = [freeDraft[j], freeDraft[i]]; renderFree(); };
  $("free-list").replaceChildren(...freeDraft.map((id, i) => {
    const m = byId.get(id);
    return el("div", { class: "it" }, el("span", { class: i === 0 ? "pill blue" : "pill" }, String(i + 1)),
      el("p", {}, el("b", {}, m ? m.name : id), i === 0 ? " · par défaut" : " · relais", el("br"),
        el("small", {}, id + (m ? " · " + usd(m.price.prompt) + " $ / " + usd(m.price.completion) + " $ le million" : " · absent du catalogue"))),
      el("span", { class: "order" },
        el("button", { class: "btn", type: "button", title: "Monter", onclick: () => move(i, -1) }, "↑"),
        el("button", { class: "btn", type: "button", title: "Descendre", onclick: () => move(i, 1) }, "↓"),
        el("button", { class: "btn danger", type: "button", title: "Retirer", onclick: () => { freeDraft.splice(i, 1); renderFree(); } }, "Retirer")));
  }));
  const cheap = [...byId.values()].filter((m) => !freeDraft.includes(m.id) && m.price.completion !== null)
    .sort((a, b) => a.price.completion - b.price.completion).slice(0, 80);
  $("free-add").replaceChildren(el("option", { value: "" }, "Ajouter un modèle (les moins chers d'abord)…"),
    ...cheap.map((m) => el("option", { value: m.id }, m.name + " · " + usd(m.price.completion) + " $ / M en sortie")));
}
$("free-add-go").addEventListener("click", () => { const id = $("free-add").value; if (id) { freeDraft.push(id); renderFree(); } });
$("free-save").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  try { await send("/models/free", { ids: freeDraft }); toast("Découverte enregistré"); await loadModels(); }
  catch (err) { toast(err.message); }
  finally { b.disabled = false; }
});
for (const id of ["mq", "mf"]) $(id).addEventListener("input", () => M && renderModels());
$("mtabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  for (const x of document.querySelectorAll("#mtabs button")) x.setAttribute("aria-selected", String(x === b));
  for (const p of document.querySelectorAll("[data-tp]")) p.hidden = p.dataset.tp !== b.dataset.t;
  $("m-filters").hidden = b.dataset.t === "decouverte" || b.dataset.t === "medias";
  mediaTab = b.dataset.t === "medias";
  $("pv-title").firstChild.textContent = mediaTab ? "Ce que l'agent peut générer " : "Aperçu dans l'app ";
  $("pv-note").textContent = mediaTab
    ? "L'agent ne voit que les médias ouverts au forfait, et prend le « Conseillé » de chaque type quand on ne lui en demande pas un autre."
    : PICKER_NOTE;
  if (mediaTab) loadMedia().catch(() => toast("Chargement impossible")); else loadPreview().catch(() => toast("Aperçu impossible"));
});
async function loadPreview() {
  const r = await get("/models/preview?plan=" + encodeURIComponent($("pv").value));
  const items = [el("div", { class: "ttl" }, "Modèle de la conversation")];
  for (const g of r.groups) {
    items.push(el("div", { class: "grp" }, g.name));
    for (const m of g.models) {
      const lock = m.baarali.unlock;
      items.push(el("div", { class: lock ? "opt locked" : "opt" }, el("span", { class: "mark" }, lock ? "🔒" : m.id === r.default ? "✓" : ""),
        el("span", {}, el("b", {}, m.name), el("small", {}, m.baarali.strength + (lock ? " · dès " + lock : ""))),
        m.baarali.recommended && !lock ? el("span", { class: "pill blue" }, "Conseillé") : null));
    }
  }
  if (!r.groups.length) items.push(el("p", { class: "empty" }, "Aucun modèle pour ce forfait."));
  $("picker").replaceChildren(...items);
}
$("pv").addEventListener("change", () => (mediaTab ? Promise.resolve(renderMediaPreview()) : loadPreview()).catch(() => toast("Aperçu impossible")));

// Pixazo (03/10/2026): media.ts is the catalog; the console opens, closes, recommends.
let mediaTab = false;
const PICKER_NOTE = $("pv-note").textContent;
let MD = null;
async function loadMedia() {
  MD = await get("/media-models");
  renderMedia();
}
async function setMedia(ids, set, done) {
  try { await send("/media-models", { ids, set }); toast(done); await loadMedia(); }
  catch (e) { toast(e.message); }
}
function renderMedia() {
  const kinds = Object.keys(MD.kinds);
  $("media-models").replaceChildren(...kinds.map((k) => {
    const list = MD.models.filter((m) => m.kind === k);
    if (!list.length) return null;
    return el("div", { class: "vendor" }, el("header", {}, el("b", {}, MD.kinds[k]), el("span", { class: "muted" }, list.filter((m) => m.enabled).length + " / " + list.length + " ouverts")),
      el("div", {}, ...list.map((m) => {
        const min = el("select", { title: "Le forfait qui l'ouvre", onchange: (e) => setMedia([m.id], { minPlan: e.target.value || null }, "Forfait changé") },
          el("option", { value: "" }, "Tous les forfaits"), ...MD.plans.slice(1).map((p) => el("option", { value: p.id }, "dès " + p.name)));
        min.value = m.minPlan || "";
        return el("div", { class: "mrow" },
          el("button", { class: "sw", type: "button", "aria-pressed": String(m.enabled), title: m.enabled ? "Proposé à l'agent : cliquer pour masquer" : "Masqué : cliquer pour l'ouvrir",
            onclick: () => setMedia([m.id], { enabled: !m.enabled }, m.enabled ? "Modèle masqué" : "Modèle ouvert") }),
          el("button", { class: "star", type: "button", "aria-pressed": String(m.recommended), title: "Conseillé : celui que l'agent préfère pour ce type",
            onclick: () => setMedia([m.id], { recommended: !m.recommended }, m.recommended ? "Plus conseillé" : "Conseillé") }, "★"),
          el("span", { class: "nm" }, el("b", {}, m.name), el("small", {}, m.id + " · ", el("span", { class: "nowrap" }, m.credits + " crédits (" + fr.format(m.usd) + " $) par défaut"))),
          min);
      })));
  }).filter(Boolean));
  renderMediaPreview();
}
function renderMediaPreview() {
  if (!MD) return;
  const plan = $("pv").value;
  const items = [el("div", { class: "ttl" }, "list_models")];
  for (const k of Object.keys(MD.kinds)) {
    const open = MD.models.filter((m) => m.kind === k && m.openFor.includes(plan));
    if (!open.length) continue;
    items.push(el("div", { class: "grp" }, MD.kinds[k]));
    for (const m of open) items.push(el("div", { class: "opt" }, el("span", { class: "mark" }, ""),
      el("span", {}, el("b", {}, m.name), el("small", {}, m.credits + " crédits par défaut")),
      m.recommended ? el("span", { class: "pill blue" }, "Conseillé") : null));
  }
  if (items.length === 1) items.push(el("p", { class: "empty" }, "Aucun média pour ce forfait."));
  $("picker").replaceChildren(...items);
}

async function loadJournal() {
  const r = await get("/journal");
  $("journal").replaceChildren(...(r.data.length ? r.data.map((j) => el("div", { class: "it" }, el("time", {}, stamp.format(j.at)),
    el("p", {}, (j.account ? j.account + " · " : "") + j.detail, el("br"), el("small", {}, "par " + j.actor)))) : [el("p", { class: "empty" }, "Rien pour l'instant.")]));
}

show(location.hash.slice(1));
`;
