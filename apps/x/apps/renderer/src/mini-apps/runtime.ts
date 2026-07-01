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
  var data = null, dataLoaded = false, state = null;
  var dataCbs = [], stateCbs = [];
  var pending = {}, seq = 0;
  function post(msg) { parent.postMessage(msg, '*'); }
  function rpc(method, params) {
    var id = 'r' + (++seq);
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'rowboat:mini-app:rpc', id: id, method: method, params: params });
    });
  }
  // data.json is a served sibling of index.html — apps load it themselves.
  function loadData() {
    return fetch('data.json', { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (d) { data = d; dataLoaded = true; dataCbs.forEach(function (cb) { try { cb(data); } catch (_) {} }); return data; })
      .catch(function () { dataLoaded = true; dataCbs.forEach(function (cb) { try { cb(null); } catch (_) {} }); return null; });
  }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'rowboat:mini-app:state') {
      state = m.state;
      stateCbs.forEach(function (cb) { try { cb(state); } catch (_) {} });
    } else if (m.type === 'rowboat:mini-app:rpc-result') {
      var p = pending[m.id];
      if (p) {
        delete pending[m.id];
        if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'request failed'));
      }
    }
  });
  window.rowboat = {
    getData: function () { return data; },
    refreshData: function () { return loadData(); },
    onData: function (cb) {
      dataCbs.push(cb);
      if (dataLoaded) { try { cb(data); } catch (_) {} }
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
    // Execute a Composio tool by slug within the app's scope. Resolves to the
    // tool result, rejects with an Error (e.g. not connected / out of scope).
    callAction: function (scope, tool, args) { return rpc('callAction', { scope: scope, tool: tool, args: args }); },
    // Find tool slugs within a toolkit. Resolves to [{ slug, name, description }].
    searchTools: function (scope, query) { return rpc('searchTools', { scope: scope, query: query }); },
    // Resolve to true/false whether the toolkit is connected.
    isConnected: function (scope) { return rpc('isConnected', { scope: scope }); },
    // Trigger the Composio OAuth flow for the toolkit. Resolves when started.
    connect: function (scope) { return rpc('connect', { scope: scope }); },
    // CORS-safe HTTP via the main process (for third-party APIs without CORS).
    // Resolves to { ok, status, text, json } (json = parsed body or null).
    fetch: function (url, opts) {
      return rpc('fetch', { url: url, method: (opts && opts.method), headers: (opts && opts.headers), body: (opts && opts.body) })
        .then(function (r) { var j = null; try { j = JSON.parse(r.text); } catch (_) {} r.json = j; return r; });
    },
    ready: function () { post({ type: 'rowboat:mini-app:ready' }); },
  };
  loadData();
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
