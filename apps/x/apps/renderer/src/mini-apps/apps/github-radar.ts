// Sample Mini App: GitHub Dashboard.
//
// A custom dashboard: pick repos to track, then view their open pull requests
// (title, author, description) — fetched LIVE from GitHub through the Phase 2
// bridge (searchTools -> callAction against a Composio managed-OAuth2 toolkit).
// Tracked repos persist via the per-app state store.

import { buildMiniAppHtml } from '../runtime'
import type { MiniApp } from '../types'

// Seed repos shown on first open (the user can add/remove their own).
const data = {
  seedRepos: [
    { owner: 'vercel', repo: 'next.js' },
    { owner: 'rowboatlabs', repo: 'rowboat' },
  ],
}

const style = `
.app { height:100%; overflow:auto; background:#0d1117; color:#e6edf3; }
.wrap { max-width:760px; margin:0 auto; padding:24px 16px 64px; }
.h { font-size:22px; font-weight:600; letter-spacing:-0.02em; margin:0 0 4px; color:#f0f6fc; }
.sub { font-size:13px; color:#8b949e; margin:0 0 18px; }
.banner { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 16px; padding:12px 14px; border:1px solid #1f6feb; background:rgba(31,111,235,0.12); border-radius:10px; }
.banner.ok { border-color:#238636; background:rgba(35,134,54,0.12); }
.banner-text { font-size:13px; color:#e6edf3; }
.banner-btn { background:#238636; color:#fff; border:0; border-radius:8px; padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.banner-btn:disabled { opacity:.6; cursor:default; }
.profile { display:flex; gap:14px; align-items:center; margin-bottom:16px; }
.avatar { width:64px; height:64px; border-radius:50%; border:1px solid #30363d; flex:0 0 auto; object-fit:cover; }
.avatar-fb { width:64px; height:64px; border-radius:50%; background:#21262d; display:none; align-items:center; justify-content:center; font-size:24px; font-weight:600; color:#8b949e; flex:0 0 auto; }
.pname { font-size:17px; font-weight:600; color:#f0f6fc; }
.plogin { font-size:13px; color:#8b949e; }
.pbio { font-size:13px; color:#adbac7; margin-top:4px; }
.pstats { display:flex; gap:16px; margin-top:8px; font-size:12px; color:#8b949e; }
.pstats b { color:#e6edf3; }
.contrib { border:1px solid #30363d; background:#161b22; border-radius:10px; padding:14px; margin-bottom:18px; }
.contrib-title { font-size:13px; font-weight:600; color:#f0f6fc; margin-bottom:10px; }
.contrib-img { width:100%; height:auto; display:block; border-radius:6px; }
.contrib-note { font-size:12px; color:#6e7681; }
.adder { display:flex; gap:8px; margin-bottom:18px; }
.adder input { flex:1; background:#0d1117; border:1px solid #30363d; color:#e6edf3; border-radius:8px; padding:8px 11px; font-size:13px; outline:none; }
.adder input:focus { border-color:#1f6feb; }
.adder button { background:#21262d; border:1px solid #30363d; color:#e6edf3; border-radius:8px; padding:0 14px; font-size:13px; font-weight:600; cursor:pointer; }
.adder button:hover { background:#30363d; }
.repo { border:1px solid #30363d; background:#161b22; border-radius:10px; margin-bottom:14px; overflow:hidden; }
.repo-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-bottom:1px solid #21262d; }
.repo-name { font-size:14px; font-weight:600; color:#2f81f7; }
.repo-actions { display:flex; gap:8px; align-items:center; }
.repo-count { font-size:12px; color:#8b949e; }
.icon-btn { background:none; border:0; color:#8b949e; cursor:pointer; font-size:13px; padding:2px 6px; border-radius:6px; }
.icon-btn:hover { background:#21262d; color:#e6edf3; }
.pr { border-bottom:1px solid #21262d; }
.pr:last-child { border-bottom:0; }
.pr-row { display:flex; gap:10px; align-items:flex-start; padding:10px 14px; cursor:pointer; }
.pr-row:hover { background:#1c2128; }
.pr-icon { color:#3fb950; font-size:13px; line-height:1.5; flex:0 0 auto; }
.pr-main { min-width:0; flex:1; }
.pr-title { font-size:13px; color:#e6edf3; }
.pr-sub { font-size:12px; color:#8b949e; margin-top:2px; }
.pr-body { padding:0 14px 12px 38px; font-size:13px; line-height:1.5; color:#adbac7; white-space:pre-wrap; word-wrap:break-word; }
.pr-body.empty { color:#6e7681; font-style:italic; }
.state { padding:14px; font-size:13px; color:#8b949e; }
.state.err { color:#f85149; }
.toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#238636; color:#fff; font-size:14px; font-weight:600; padding:10px 18px; border-radius:8px; opacity:0; transition:opacity .2s; pointer-events:none; }
.toast.show { opacity:1; }
.toast.err { background:#da3633; }
.empty-state { padding:32px 14px; text-align:center; color:#6e7681; font-size:13px; }
.loading { padding:48px 16px; text-align:center; color:#8b949e; }
`

const script = `
var root = document.getElementById('root');
var seed = [];
var repos = null;          // [{owner,repo}], persisted
var expanded = {};         // pr key -> bool
var prCache = {};          // 'owner/repo' -> { loading, error, prs }
var profile = null;        // authenticated user profile
var profileState = null;   // { loading, error }
var repoInput = '';
var connected = null;
var connecting = false;
var toastTimer = null;

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function key(o,r){ return o + '/' + r; }
function persist(){ window.rowboat.setState({ repos: repos }); }

// ---- live GitHub reads via the bridge -------------------------------------
function asArray(d){
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    var keys = ['details','data','items','pull_requests','pullRequests','response_data','result'];
    for (var i=0;i<keys.length;i++){ if (Array.isArray(d[keys[i]])) return d[keys[i]]; }
    for (var k in d){ if (Array.isArray(d[k]) && d[k].length && typeof d[k][0] === 'object') return d[k]; }
  }
  return [];
}
function normPRs(d){
  return asArray(d).map(function(p){
    return {
      number: (p.number != null ? p.number : (p.id != null ? p.id : '?')),
      title: p.title || '(untitled)',
      body: (p.body || '').trim(),
      author: (p.user && (p.user.login || p.user.name)) || p.author || '',
      url: p.html_url || p.url || ''
    };
  });
}
// Pick the *list pull requests* tool, excluding review/comment/file/commit
// variants that happen to contain PULL + LIST but need pull_number/review_id.
function pickPRTool(tools){
  var bad = ['REVIEW','COMMENT','FILE','COMMIT','REQUESTED'];
  function ok(s){ for (var i=0;i<bad.length;i++) if (s.indexOf(bad[i])>=0) return false; return true; }
  for (var i=0;i<tools.length;i++){ if ((tools[i].slug||'').toUpperCase() === 'GITHUB_LIST_PULL_REQUESTS') return tools[i]; }
  for (var j=0;j<tools.length;j++){ var s=(tools[j].slug||'').toUpperCase(); if (/LIST_PULL_REQUESTS$/.test(s) && ok(s)) return tools[j]; }
  for (var m=0;m<tools.length;m++){ var t=(tools[m].slug||'').toUpperCase(); if (t.indexOf('PULL_REQUEST')>=0 && t.indexOf('LIST')>=0 && ok(t)) return tools[m]; }
  return null;
}
function fetchPRs(o, r){
  var k = key(o,r);
  prCache[k] = { loading:true }; render();
  var args = { owner:o, repo:r, state:'open', sort:'updated', direction:'desc', per_page:20 };
  // Canonical slug first; fall back to a strict search only if it's unknown.
  window.rowboat.callAction('github', 'GITHUB_LIST_PULL_REQUESTS', args).catch(function(){
    return window.rowboat.searchTools('github','list pull requests for a repository').then(function(tools){
      var tool = pickPRTool(tools || []);
      if (!tool) throw new Error('could not find a list-pull-requests tool');
      return window.rowboat.callAction('github', tool.slug, args);
    });
  }).then(function(d){
    prCache[k] = { loading:false, prs: normPRs(d) }; render();
  }).catch(function(e){
    prCache[k] = { loading:false, error: (e && e.message ? e.message : String(e)) }; render();
  });
}
function fetchAll(){ if (!connected) return; loadProfile(); if (!repos) return; repos.forEach(function(rp){ var k=key(rp.owner,rp.repo); if (!prCache[k]) fetchPRs(rp.owner, rp.repo); }); }

// ---- authenticated user profile -------------------------------------------
function asObj(d){
  if (d && typeof d === 'object'){
    if (d.login) return d;
    var ks = ['data','details','response_data','result','user'];
    for (var i=0;i<ks.length;i++){ var v=d[ks[i]]; if (v && typeof v === 'object' && v.login) return v; }
  }
  return d || {};
}
function loadProfile(){
  if (!connected || profile || (profileState && profileState.loading)) return;
  profileState = { loading:true }; render();
  window.rowboat.callAction('github','GITHUB_GET_THE_AUTHENTICATED_USER',{}).catch(function(){
    return window.rowboat.searchTools('github','get the authenticated user').then(function(tools){
      var pick = null;
      for (var i=0;i<(tools||[]).length;i++){ if (/AUTHENTICATED_USER$/.test((tools[i].slug||'').toUpperCase())){ pick = tools[i]; break; } }
      if (!pick && tools && tools.length) pick = tools[0];
      if (!pick) throw new Error('no profile tool found');
      return window.rowboat.callAction('github', pick.slug, {});
    });
  }).then(function(d){
    var u = asObj(d);
    profile = { login:u.login||'', name:u.name||u.login||'', avatar:u.avatar_url||'', bio:u.bio||'', repos:u.public_repos||0, followers:u.followers||0, following:u.following||0 };
    profileState = { loading:false }; render();
  }).catch(function(e){
    profileState = { loading:false, error:(e && e.message ? e.message : String(e)) }; render();
  });
}

// ---- connection -----------------------------------------------------------
function bannerHtml(){
  if (connecting) return '<div class="banner"><span class="banner-text">Connecting GitHub — finish in your browser…</span><button class="banner-btn" disabled>Connecting…</button></div>';
  if (connected === false) return '<div class="banner"><span class="banner-text">Connect GitHub to load pull requests.</span><button class="banner-btn" data-connect="1">Connect GitHub</button></div>';
  if (connected === true) return '<div class="banner ok"><span class="banner-text">GitHub connected — pull requests are live.</span></div>';
  return '';
}
function checkConn(){ window.rowboat.isConnected('github').then(function(c){ connected = c; render(); fetchAll(); }); }
function connect(){
  connecting = true; render();
  window.rowboat.connect('github').then(function(){
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      window.rowboat.isConnected('github').then(function(c){
        if (c){ connected = true; connecting = false; clearInterval(iv); render(); flash('GitHub connected'); fetchAll(); }
        else if (tries > 30){ connecting = false; clearInterval(iv); render(); }
      });
    }, 2000);
  }).catch(function(e){ connecting = false; render(); flash('Connect failed: ' + (e && e.message ? e.message : e), true); });
}

// ---- repo management ------------------------------------------------------
function addRepo(){
  var v = (repoInput || '').trim().replace(/^https?:\\/\\/github.com\\//i, '');
  var m = v.match(/^([\\w.-]+)\\/([\\w.-]+)$/);
  if (!m){ flash('Enter as owner/repo', true); return; }
  var o = m[1], r = m[2];
  if (repos.some(function(x){ return x.owner === o && x.repo === r; })){ flash('Already tracked'); return; }
  repos.push({ owner:o, repo:r }); repoInput = ''; persist(); render();
  if (connected) fetchPRs(o, r);
}
function removeRepo(o, r){
  repos = repos.filter(function(x){ return !(x.owner === o && x.repo === r); });
  delete prCache[key(o,r)]; persist(); render();
}

// ---- render ---------------------------------------------------------------
function prHtml(o, r, pr){
  var k = key(o,r) + '#' + pr.number;
  var open = !!expanded[k];
  var body = open
    ? (pr.body ? '<div class="pr-body">' + esc(pr.body) + '</div>' : '<div class="pr-body empty">No description.</div>')
    : '';
  return '<div class="pr"><div class="pr-row" data-pr="' + esc(k) + '">'
    + '<span class="pr-icon">⌥</span><div class="pr-main">'
    + '<div class="pr-title">' + esc(pr.title) + '</div>'
    + '<div class="pr-sub">#' + esc(pr.number) + (pr.author ? ' · ' + esc(pr.author) : '') + '</div>'
    + '</div></div>' + body + '</div>';
}
function repoHtml(rp){
  var k = key(rp.owner, rp.repo);
  var c = prCache[k];
  var inner;
  if (!connected) inner = '<div class="state">Connect GitHub to load PRs.</div>';
  else if (!c || c.loading) inner = '<div class="state">Loading pull requests…</div>';
  else if (c.error) inner = '<div class="state err">' + esc(c.error) + '</div>';
  else if (!c.prs.length) inner = '<div class="empty-state">No open pull requests 🎉</div>';
  else inner = c.prs.map(function(pr){ return prHtml(rp.owner, rp.repo, pr); }).join('');
  var count = (c && c.prs) ? '<span class="repo-count">' + c.prs.length + ' open</span>' : '';
  return '<div class="repo"><div class="repo-head">'
    + '<span class="repo-name">' + esc(rp.owner) + '/' + esc(rp.repo) + '</span>'
    + '<span class="repo-actions">' + count
    + '<button class="icon-btn" data-refresh="' + esc(k) + '">↻</button>'
    + '<button class="icon-btn" data-remove="' + esc(k) + '">✕</button>'
    + '</span></div>' + inner + '</div>';
}
function profileHtml(){
  if (!connected) return '';
  if (!profile) return (profileState && profileState.loading) ? '<div class="state">Loading profile…</div>' : '';
  var initials = (profile.name || profile.login || '?').slice(0,1).toUpperCase();
  var img = profile.avatar ? '<img class="avatar" src="' + esc(profile.avatar) + '" alt="" />' : '';
  var fbStyle = profile.avatar ? '' : ' style="display:flex"';
  return '<div class="profile">' + img
    + '<div id="avfb" class="avatar-fb"' + fbStyle + '>' + esc(initials) + '</div>'
    + '<div><div class="pname">' + esc(profile.name) + '</div><div class="plogin">@' + esc(profile.login) + '</div>'
    + (profile.bio ? '<div class="pbio">' + esc(profile.bio) + '</div>' : '')
    + '<div class="pstats"><span><b>' + profile.repos + '</b> repos</span><span><b>' + profile.followers + '</b> followers</span><span><b>' + profile.following + '</b> following</span></div>'
    + '</div></div>'
    + '<div class="contrib"><div class="contrib-title">Contributions</div>'
    + '<img class="contrib-img" src="https://ghchart.rshah.org/' + encodeURIComponent(profile.login) + '" alt="contributions" />'
    + '<div id="contribnote" class="contrib-note" style="display:none">Contribution graph could not load.</div>'
    + '</div>';
}
function render(){
  var list = repos
    ? (repos.length ? repos.map(repoHtml).join('') : '<div class="empty-state">No repos yet — add one above.</div>')
    : '<div class="loading">Loading…</div>';
  root.innerHTML = '<div class="app"><div class="wrap">'
    + '<h1 class="h">GitHub Dashboard</h1><p class="sub">Track repos and read their open pull requests.</p>'
    + bannerHtml()
    + profileHtml()
    + '<div class="adder"><input id="repo-input" placeholder="owner/repo (e.g. vercel/next.js)" /><button data-add="1">Add</button></div>'
    + list
    + '</div><div class="toast" id="toast"></div></div>';
  var el = document.getElementById('repo-input');
  if (el) el.value = repoInput;
  var av = root.querySelector('.avatar');
  if (av) av.onerror = function(){ this.style.display='none'; var f=document.getElementById('avfb'); if (f) f.style.display='flex'; };
  var ci = root.querySelector('.contrib-img');
  if (ci) ci.onerror = function(){ this.style.display='none'; var n=document.getElementById('contribnote'); if (n) n.style.display='block'; };
}

function flash(msg, isErr){
  var el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg; el.className = 'toast show' + (isErr ? ' err' : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.className = 'toast' + (isErr ? ' err' : ''); }, 2400);
}

// ---- events ---------------------------------------------------------------
root.addEventListener('input', function(e){ if (e.target && e.target.id === 'repo-input') repoInput = e.target.value; });
root.addEventListener('keydown', function(e){ if (e.target && e.target.id === 'repo-input' && e.key === 'Enter') addRepo(); });
root.addEventListener('click', function(e){
  var t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('[data-connect]')) { connect(); return; }
  if (t.closest('[data-add]')) { addRepo(); return; }
  var rm = t.closest('[data-remove]');
  if (rm) { var p = rm.getAttribute('data-remove').split('/'); removeRepo(p[0], p[1]); return; }
  var rf = t.closest('[data-refresh]');
  if (rf) { var q = rf.getAttribute('data-refresh').split('/'); fetchPRs(q[0], q[1]); return; }
  var pr = t.closest('[data-pr]');
  if (pr) { var pk = pr.getAttribute('data-pr'); expanded[pk] = !expanded[pk]; render(); return; }
});

window.rowboat.onData(function(d){ seed = (d && d.seedRepos) || []; if (repos === null) { repos = seed.slice(); render(); } });
window.rowboat.onState(function(st){
  if (st && st.repos) { repos = st.repos; render(); fetchAll(); }
  else if (repos === null) { repos = seed.slice(); render(); }
});
render();
window.rowboat.ready();
checkConn();
`

export const githubRadarApp: MiniApp = {
  id: 'github-radar',
  name: 'GitHub Dashboard',
  description: 'Track repos and read their open pull requests — live via GitHub.',
  source: 'GitHub',
  active: true,
  lastRun: 'just now',
  scope: ['github'],
  data,
  html: buildMiniAppHtml({ title: 'GitHub Dashboard', style, script }),
}
