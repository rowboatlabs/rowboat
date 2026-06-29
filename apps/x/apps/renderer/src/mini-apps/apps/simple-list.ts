// Lightweight Mini App template: a clean single-column list of items.
//
// Used for simple "digest"-style apps (newsletter summaries, competitor updates)
// so the gallery shows the card design across multiple apps. Same dependency-free
// vanilla approach as the Twitter client.

import { buildMiniAppHtml } from '../runtime'

export type ListItem = { id: string; title: string; meta: string; body: string }

const style = `
.app { height:100%; overflow:auto; background:#0a0a0b; color:#e7e9ea; }
.wrap { max-width:640px; margin:0 auto; padding:24px 16px; }
.h { font-size:22px; font-weight:600; letter-spacing:-0.02em; margin:0 0 4px; color:#f5f5f5; }
.sub { font-size:13px; color:#71767b; margin:0 0 20px; }
.item { border:1px solid rgba(255,255,255,0.07); background:#141417; border-radius:14px; padding:16px; margin-bottom:12px; }
.it-top { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
.it-title { font-size:15px; font-weight:600; }
.it-meta { font-size:12px; color:#71767b; flex:0 0 auto; }
.it-body { font-size:14px; line-height:1.5; color:rgba(255,255,255,0.7); margin:6px 0 0; }
.loading { padding:48px 16px; text-align:center; color:#71767b; }
`

const script = `
var root = document.getElementById('root');
var current = null;
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function render(){
  if(!current){ root.innerHTML = '<div class="app"><div class="loading">Loading…</div></div>'; return; }
  var items = (current.items||[]).map(function(it){
    return '<div class="item"><div class="it-top"><div class="it-title">'+esc(it.title)+'</div><div class="it-meta">'+esc(it.meta)+'</div></div>'
      + '<p class="it-body">'+esc(it.body)+'</p></div>';
  }).join('');
  root.innerHTML = '<div class="app"><div class="wrap"><h1 class="h">'+esc(current.title)+'</h1><p class="sub">'+esc(current.subtitle)+'</p>'+items+'</div></div>';
}
window.rowboat.onData(function(d){ current = d; render(); });
render();
window.rowboat.ready();
`

export function buildSimpleListHtml(title: string): string {
  return buildMiniAppHtml({ title, style, script })
}
