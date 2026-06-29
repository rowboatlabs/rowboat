// Mini Apps — app HTML scaffolding shared by every app.
//
// `buildMiniAppHtml` wraps an app's markup/JS in a single self-contained HTML
// document and injects the `window.rowboat` bridge shim before the app runs.
//
// Phase 1 is deliberately dependency-free: NO remote CDNs and NO in-browser
// transpile. Apps are plain HTML + CSS + JS so they render reliably inside the
// sandboxed, opaque-origin iframe and work offline. Later phases can layer in a
// locally-bundled React runtime (esbuild-at-save) without changing the bridge.

/**
 * The bridge shim, injected as a plain <script> before the app's script. It
 * defines `window.rowboat` and speaks the postMessage protocol in ./types.ts.
 * This is the only channel the app has to the host.
 */
const BRIDGE_SHIM = /* js */ `
(function () {
  var data = null, state = null;
  var dataCbs = [], stateCbs = [];
  var pending = {}, seq = 0;
  function post(msg) { parent.postMessage(msg, '*'); }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'rowboat:mini-app:data') {
      data = m.data;
      dataCbs.forEach(function (cb) { try { cb(data); } catch (_) {} });
    } else if (m.type === 'rowboat:mini-app:state') {
      state = m.state;
      stateCbs.forEach(function (cb) { try { cb(state); } catch (_) {} });
    } else if (m.type === 'rowboat:mini-app:action-result') {
      var p = pending[m.id];
      if (p) {
        delete pending[m.id];
        if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'action failed'));
      }
    }
  });
  window.rowboat = {
    getData: function () { return data; },
    onData: function (cb) {
      dataCbs.push(cb);
      if (data !== null) { try { cb(data); } catch (_) {} }
      return function () { var i = dataCbs.indexOf(cb); if (i >= 0) dataCbs.splice(i, 1); };
    },
    getState: function () { return state; },
    onState: function (cb) {
      stateCbs.push(cb);
      if (state !== null) { try { cb(state); } catch (_) {} }
      return function () { var i = stateCbs.indexOf(cb); if (i >= 0) stateCbs.splice(i, 1); };
    },
    setState: function (patch) {
      state = Object.assign({}, state || {}, patch);
      post({ type: 'rowboat:mini-app:setState', patch: patch });
      stateCbs.forEach(function (cb) { try { cb(state); } catch (_) {} });
    },
    callAction: function (scope, action, args) {
      var id = 'a' + (++seq);
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        post({ type: 'rowboat:mini-app:action', id: id, scope: scope, action: action, args: args });
      });
    },
    ready: function () { post({ type: 'rowboat:mini-app:ready' }); },
  };
})();
`

/**
 * Build a complete self-contained HTML document for a Mini App.
 * @param title  Document title.
 * @param style  App CSS (inlined into a <style> tag).
 * @param body   Initial body markup (often just a mount node).
 * @param script App JS. Runs after the bridge shim; `window.rowboat` is ready.
 */
export function buildMiniAppHtml({
  title,
  style = '',
  body = '<div id="root"></div>',
  script,
}: {
  title: string
  style?: string
  body?: string
  script: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
${style}
  </style>
</head>
<body>
  ${body}
  <script>${BRIDGE_SHIM}</script>
  <script>
${script}
  </script>
</body>
</html>`
}
