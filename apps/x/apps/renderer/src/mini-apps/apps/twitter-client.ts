// Sample Mini App: a Twitter/X client.
//
// An X-style single-column timeline of important posts the agent has curated,
// with simple topic chips to filter what you see. Phase 1 ships static `data`
// and stubbed actions; later the bg-tasks engine produces the feed on a trigger
// and the bridge runs real Composio actions.
//
// Dependency-free vanilla JS + CSS so it renders reliably in the sandboxed
// iframe with no network. window.rowboat is the only channel to the host;
// selected topics persist via rowboat.setState.

import { buildMiniAppHtml } from '../runtime'
import type { MiniApp } from '../types'

const data = {
  handle: '@you',
  topics: ['AI', 'Startups', 'Dev', 'Design'],
  posts: [
    {
      id: 't1',
      author: 'Andrej Karpathy',
      handle: '@karpathy',
      avatar: '🧠',
      time: '2h',
      topics: ['AI', 'Dev'],
      text: 'The hottest new programming language is English. Spend your time crafting the prompt, not the syntax.',
      likes: 1240,
      reposts: 312,
    },
    {
      id: 't2',
      author: 'Vercel',
      handle: '@vercel',
      avatar: '▲',
      time: '5h',
      topics: ['Dev'],
      text: 'Shipping is a feature. We just cut cold starts by another 40% on the edge runtime.',
      likes: 842,
      reposts: 96,
    },
    {
      id: 't3',
      author: 'Indie Hackers',
      handle: '@IndieHackers',
      avatar: '🚀',
      time: '1h',
      topics: ['Startups'],
      text: 'You do not need 1,000 true fans. You need 100 who will tell 10 friends each. Build for the tellers.',
      likes: 503,
      reposts: 121,
    },
    {
      id: 't4',
      author: 'Sarah Dev',
      handle: '@sarah_builds',
      avatar: '👩‍💻',
      time: '32m',
      topics: ['AI', 'Startups'],
      text: 'Anyone using local-first AI desktop apps day to day? Curious what actually sticks vs. demo-ware.',
      likes: 88,
      reposts: 7,
    },
    {
      id: 't5',
      author: 'Design Notes',
      handle: '@designnotes',
      avatar: '🎨',
      time: '3h',
      topics: ['Design'],
      text: 'Good defaults beat good settings. Every preference you add is a decision you forced on the user.',
      likes: 967,
      reposts: 204,
    },
    {
      id: 't6',
      author: 'Founder Diary',
      handle: '@founderdiary',
      avatar: '📈',
      time: '6h',
      topics: ['Startups', 'Design'],
      text: 'Talked to 12 users this week. Shipped 0 features. Best week in a month.',
      likes: 1502,
      reposts: 388,
    },
  ],
}

const style = `
.app { height:100%; overflow:auto; background:#000; color:#e7e9ea; }
.feed { max-width:600px; margin:0 auto; border-left:1px solid #2f3336; border-right:1px solid #2f3336; min-height:100%; }
.header { position:sticky; top:0; backdrop-filter:blur(12px); background:rgba(0,0,0,.65); border-bottom:1px solid #2f3336; padding:12px 16px; z-index:2; }
.h-title { font-size:20px; font-weight:800; margin:0 0 10px; }
.chips { display:flex; gap:8px; flex-wrap:wrap; }
.chip { border:1px solid #536471; background:transparent; color:#e7e9ea; border-radius:999px; padding:5px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.chip.on { background:#1d9bf0; border-color:#1d9bf0; color:#fff; }
.post { display:flex; gap:12px; padding:12px 16px; border-bottom:1px solid #2f3336; }
.post:hover { background:#080808; }
.avatar { width:40px; height:40px; border-radius:50%; background:#16181c; display:flex; align-items:center; justify-content:center; font-size:18px; flex:0 0 auto; }
.pbody { flex:1; min-width:0; }
.line { display:flex; align-items:center; gap:4px; font-size:15px; }
.name { font-weight:700; }
.handle, .dot, .time { color:#71767b; font-weight:400; }
.text { font-size:15px; line-height:1.4; margin:2px 0 0; white-space:pre-wrap; word-wrap:break-word; }
.tags { margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; }
.tag { font-size:12px; color:#1d9bf0; }
.actions { display:flex; justify-content:space-between; max-width:300px; margin-top:8px; }
.action { display:flex; align-items:center; gap:6px; background:none; border:0; color:#71767b; font-size:13px; cursor:pointer; padding:4px; border-radius:999px; }
.action:hover { color:#1d9bf0; }
.action.like.on { color:#f91880; }
.action.repost.on { color:#00ba7c; }
.empty { padding:48px 16px; text-align:center; color:#71767b; font-size:15px; }
.toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1d9bf0; color:#fff; font-size:14px; font-weight:600; padding:10px 18px; border-radius:999px; opacity:0; transition:opacity .2s; pointer-events:none; }
.toast.show { opacity:1; }
.loading { padding:48px 16px; text-align:center; color:#71767b; font-size:15px; }
`

// Vanilla JS. No backticks (so it embeds cleanly); window.rowboat is the bridge.
const script = `
var root = document.getElementById('root');
var current = null;
var selected = null;        // selected topic names
var liked = {};             // id -> bool
var reposted = {};          // id -> bool
var toastTimer = null;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n);
}
function persist() {
  window.rowboat.setState({ topics: selected, liked: liked, reposted: reposted });
}

function postHtml(p) {
  var likeOn = liked[p.id] ? ' on' : '';
  var repoOn = reposted[p.id] ? ' on' : '';
  var likeCt = p.likes + (liked[p.id] ? 1 : 0);
  var repoCt = p.reposts + (reposted[p.id] ? 1 : 0);
  var tags = (p.topics || []).map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('');
  return '<div class="post">'
    + '<div class="avatar">' + esc(p.avatar) + '</div>'
    + '<div class="pbody">'
    + '<div class="line"><span class="name">' + esc(p.author) + '</span>'
    + '<span class="handle">' + esc(p.handle) + '</span><span class="dot">·</span><span class="time">' + esc(p.time) + '</span></div>'
    + '<p class="text">' + esc(p.text) + '</p>'
    + (tags ? '<div class="tags">' + tags + '</div>' : '')
    + '<div class="actions">'
    + '<button class="action reply" data-action="reply" data-id="' + p.id + '">💬</button>'
    + '<button class="action repost' + repoOn + '" data-action="repost" data-id="' + p.id + '">🔁 <span class="ct">' + fmt(repoCt) + '</span></button>'
    + '<button class="action like' + likeOn + '" data-action="like" data-id="' + p.id + '">' + (liked[p.id] ? '♥' : '♡') + ' <span class="ct">' + fmt(likeCt) + '</span></button>'
    + '</div></div></div>';
}

function render() {
  if (!current) { root.innerHTML = '<div class="app"><div class="feed"><div class="loading">Loading your feed…</div></div></div>'; return; }
  var chips = current.topics.map(function (t) {
    var on = selected.indexOf(t) >= 0 ? ' on' : '';
    return '<button class="chip' + on + '" data-topic="' + esc(t) + '">' + esc(t) + '</button>';
  }).join('');
  var visible = current.posts.filter(function (p) {
    return (p.topics || []).some(function (t) { return selected.indexOf(t) >= 0; });
  });
  var body = visible.length
    ? visible.map(postHtml).join('')
    : '<div class="empty">No posts. Pick a topic above to see what is happening.</div>';
  root.innerHTML = '<div class="app"><div class="feed">'
    + '<div class="header"><h1 class="h-title">Home</h1><div class="chips">' + chips + '</div></div>'
    + body
    + '</div><div class="toast" id="toast"></div></div>';
}

function flash(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast'; }, 2000);
}

root.addEventListener('click', function (e) {
  var t = e.target;
  var chip = t && t.closest ? t.closest('.chip') : null;
  if (chip) {
    var topic = chip.getAttribute('data-topic');
    var i = selected.indexOf(topic);
    if (i >= 0) selected.splice(i, 1); else selected.push(topic);
    persist();
    render();
    return;
  }
  var btn = t && t.closest ? t.closest('.action') : null;
  if (!btn) return;
  var action = btn.getAttribute('data-action');
  var id = btn.getAttribute('data-id');
  if (action === 'reply') { flash('Reply drafted (demo)'); return; }
  if (action === 'like') { liked[id] = !liked[id]; }
  if (action === 'repost') { reposted[id] = !reposted[id]; }
  persist();
  render();
  window.rowboat.callAction('twitter', action, { id: id }).then(function (res) {
    flash((res && res.message) || 'Done');
  }).catch(function (err) {
    flash('Failed: ' + (err && err.message ? err.message : err));
  });
});

window.rowboat.onData(function (d) {
  current = d;
  if (selected === null) selected = d.topics.slice();
  render();
});
window.rowboat.onState(function (st) {
  if (!st) return;
  if (st.topics) selected = st.topics;
  if (st.liked) liked = st.liked;
  if (st.reposted) reposted = st.reposted;
  if (current) render();
});
render();
window.rowboat.ready();
`

export const twitterClientApp: MiniApp = {
  id: 'twitter-client',
  name: 'Twitter, curated',
  description: 'An X-style feed of the posts that matter, filtered by your topics.',
  source: 'Twitter',
  active: true,
  lastRun: '2m ago',
  scope: ['twitter'],
  data,
  html: buildMiniAppHtml({ title: 'Twitter, curated', style, script }),
}
