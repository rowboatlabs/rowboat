// The two of them above the sign-in form (decided 02/10/2026, from the
// founder's reference video): two Baarali marks who talk between
// themselves about what the person types — a bubble shows "…" first, as
// someone writing, then the words — and so guide them, errors included.
// Their eyes follow the field being typed in and close for a password; they
// nod at a success and shake at a refusal. Plain SVG, CSS and a few lines of
// script: the page loads nothing from elsewhere (its CSP admits its nonce
// only), and setting element.style from script is allowed by it.

// The same drawing as logo.ts: the B that looks at you, on its two feet.
const BODY =
  'M450 250 H502 C574 250 612 280 612 322 C612 345 602 360 590 368 Q584 373 590 378 C612 388 626 408 626 436 C626 476 590 502 512 502 H450 C413 502 384 473 384 436 V316 C384 279 413 250 450 250 Z';

function mark(cls: string, size: number, tile: string, ink: string, eye: string, feet: string): string {
  return `<svg class="${cls}" viewBox="0 0 1024 1024" width="${size}" height="${size}" aria-hidden="true" focusable="false"><rect width="1024" height="1024" rx="230" fill="${tile}"/><g transform="translate(512 512) scale(1.7) translate(-505 -423)"><g class="d-body"><path d="${BODY}" fill="${ink}"/><g class="d-eyes"><g class="d-lids"><circle cx="500" cy="324" r="12" fill="${eye}"/><circle cx="554" cy="324" r="12" fill="${eye}"/></g></g></g><circle cx="460" cy="556" r="38" fill="${feet}"/><circle cx="552" cy="556" r="38" fill="${feet}"/></g></svg>`;
}

/** The stage: the two marks and their two bubbles. */
export function duoStage(): string {
  return `<div class="duo-stage">
  <div class="bubble l" id="say1" aria-live="polite"></div>
  <div class="bubble r" id="say2" aria-live="polite"></div>
  <div class="duo">${mark('d1', 86, '#1A6DFF', '#FFFFFF', '#0A0A0A', '#FFFFFF')}${mark('d2', 70, '#0A0A0A', '#FFFFFF', '#1A6DFF', '#1A6DFF')}</div>
</div>`;
}

export const DUO_CSS = `
.duo-stage { position:relative; height:150px; margin:0 -10px; }
.duo { position:absolute; left:50%; bottom:6px; transform:translateX(-50%); display:flex; align-items:flex-end; }
.duo svg { display:block; overflow:visible; }
.duo .d2 { margin-left:-14px; margin-bottom:-4px; }
.d-eyes { transition:transform .18s ease-out; }
.d-lids, .d-body { transform-box:fill-box; }
.d-lids { transform-origin:50% 50%; transition:transform .2s; animation:d-blink 5.2s infinite; }
.d-body { transform-origin:50% 100%; }
.shut .d-lids { transform:scaleY(.12); animation:none; }
.nod .d-body { animation:d-nod .5s ease 2; }
.shake .d-body { animation:d-shake .45s ease; }
.hop .d-body { animation:d-hop .6s cubic-bezier(.3,.7,.3,1); }
@keyframes d-blink { 0%, 93%, 100% { transform:scaleY(1); } 96% { transform:scaleY(.1); } }
@keyframes d-nod { 50% { transform:translateY(18px) scaleY(.94); } }
@keyframes d-shake { 20% { transform:translateX(-30px); } 40% { transform:translateX(26px); } 60% { transform:translateX(-18px); } 80% { transform:translateX(10px); } }
@keyframes d-hop { 45% { transform:translateY(-90px); } }
.bubble { position:absolute; width:max-content; max-width:min(160px, calc(50% - 34px)); background:var(--card); border:1px solid var(--line); color:var(--accent); font-size:13px; line-height:1.35; padding:7px 11px; border-radius:12px; box-shadow:0 8px 20px -14px rgb(10 10 10 / .4); opacity:0; transform:translateY(6px) scale(.96); transition:opacity .2s, transform .2s; pointer-events:none; }
.bubble.on { opacity:1; transform:none; }
.bubble.l { right:calc(50% + 30px); top:22px; border-bottom-right-radius:4px; }
.bubble.r { left:calc(50% + 30px); top:4px; border-bottom-left-radius:4px; }
.bubble.err { color:var(--error); }
.dots { display:inline-flex; gap:3px; padding:3px 0; }
.dots i { width:5px; height:5px; border-radius:50%; background:currentColor; opacity:.4; animation:d-dot 1s infinite; }
.dots i:nth-child(2) { animation-delay:.15s; } .dots i:nth-child(3) { animation-delay:.3s; }
@keyframes d-dot { 40% { opacity:1; transform:translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { .d-lids, .nod .d-body, .shake .d-body, .hop .d-body, .dots i { animation:none; } .d-eyes, .bubble { transition:none; } }
`;

/**
 * window.duo: say(first, second, { err }), act("nod" | "shake" | "hop"),
 * shut(bool), watch(input) — eyes toward the end of what is typed.
 */
export const DUO_JS = `
(() => {
  const marks = [...document.querySelectorAll(".duo svg")];
  const one = document.getElementById("say1"), two = document.getElementById("say2");
  if (!marks.length || !one || !two) return;
  one.dataset.side = "l"; two.dataset.side = "r";
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timers = [], last = "";
  const show = (el, text, delay, err) => {
    el.classList.remove("on");
    if (!text) return;
    const put = (html) => { el.className = "bubble " + el.dataset.side + (err ? " err" : "") + " on"; el.innerHTML = html; };
    if (still) { timers.push(setTimeout(() => { put(""); el.textContent = text; }, delay)); return; }
    timers.push(setTimeout(() => put('<span class="dots"><i></i><i></i><i></i></span>'), delay));
    timers.push(setTimeout(() => { el.textContent = text; }, delay + 650));
  };
  const say = (a, b, opts) => {
    const err = Boolean(opts && opts.err);
    const key = a + "|" + b + "|" + err;
    if (key === last) return;
    last = key;
    timers.forEach(clearTimeout); timers = [];
    show(one, a, 0, err);
    show(two, b, a ? 900 : 0, err);
  };
  const act = (cls) => {
    if (still) return;
    for (const s of marks) { s.classList.remove("nod", "shake", "hop"); void s.getBoundingClientRect(); s.classList.add(cls); }
  };
  const shut = (on) => { for (const s of marks) s.classList.toggle("shut", on); };
  const lookAt = (x, y) => {
    for (const s of marks) {
      const r = s.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height * .42);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 200);
      s.querySelector(".d-eyes").style.transform = "translate(" + (dx / d * 20 * k).toFixed(1) + "px," + (dy / d * 13 * k).toFixed(1) + "px)";
    }
  };
  const ruler = document.createElement("canvas").getContext("2d");
  const watch = (input) => {
    const r = input.getBoundingClientRect();
    ruler.font = getComputedStyle(input).font;
    const w = Math.min(ruler.measureText(input.type === "password" ? "" : input.value).width, r.width - 30);
    lookAt(r.left + 14 + w, r.top + r.height / 2);
  };
  if (!still) window.addEventListener("pointermove", (e) => {
    const a = document.activeElement;
    if (!a || a === document.body || a.tagName === "BUTTON") lookAt(e.clientX, e.clientY);
  }, { passive: true });
  window.duo = { say, act, shut, watch };
})();
`;
