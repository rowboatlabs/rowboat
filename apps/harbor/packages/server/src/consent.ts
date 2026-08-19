// The login/consent page (spec §4, spike-verified 2026-08-18): the one human
// moment of the OAuth dance. GoTrue redirects the browser here with an
// authorization_id; the page signs the person in (social providers ONLY —
// browser → AS directly, Harbor never sees or proxies a credential), performs
// the MANDATORY claim step (GET authorization details — skipping it 404s the
// consent), renders "«client» wants access", and POSTs approve/deny; the AS
// answers with the redirect that carries the code back to the client.
//
// This is Supabase-flagship glue, not protocol: an org whose AS hosts its own
// login+consent (Keycloak, corporate IdP) never mounts this route. Sessions
// ride sessionStorage only and are cleared after the decision.
//
// Sign-in buttons are DERIVED, not configured: the page fetches the AS's
// public /settings and renders exactly the social providers that project has
// enabled (live-verified shape: external.{google,azure,github,…}: bool, with
// email/phone/anonymous_users as the non-redirect entries to skip). A
// self-hoster who enables GitHub sees a GitHub button with zero Harbor
// config; our fleet enables Google + Microsoft and sees those.

export interface ConsentPageOptions {
  /** The pinned AS issuer (GoTrue base URL), e.g. https://<project>.supabase.co/auth/v1 */
  issuer: string;
  /** The AS's publishable/anon key — public by design; the browser needs it as `apikey`. */
  publishableKey: string;
  /** Shown on the page so people know whose door they're at. */
  orgName: string;
}

/** Display names where capitalizing the provider id isn't right. */
const PROVIDER_LABELS: Record<string, string> = {
  azure: 'Microsoft',
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin_oidc: 'LinkedIn',
  workos: 'WorkOS',
  slack_oidc: 'Slack',
};

/** /settings `external` entries that are not redirect-style social providers. */
const NON_SOCIAL = ['email', 'phone', 'anonymous_users'];

export function consentPageHtml(opts: ConsentPageOptions): string {
  const cfg = JSON.stringify({
    issuer: opts.issuer.replace(/\/$/, ''),
    apikey: opts.publishableKey,
    labels: PROVIDER_LABELS,
    nonSocial: NON_SOCIAL,
  });
  const orgName = escapeHtml(opts.orgName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — ${orgName}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh;
         background: light-dark(#f6f6f4, #16161a); color: light-dark(#1a1a1a, #ececec); }
  .card { width: min(92vw, 380px); padding: 28px; border-radius: 12px; background: light-dark(#fff, #1f1f25);
          box-shadow: 0 2px 16px rgba(0,0,0,.12); }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .org { font-size: 13px; opacity: .65; margin: 0 0 20px; }
  .ask { font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  .ask b { font-weight: 600; }
  button, .btn { display: block; width: 100%; box-sizing: border-box; padding: 10px 14px; margin: 8px 0;
          border-radius: 8px; border: 1px solid light-dark(#d4d4d0, #3a3a42); font-size: 14px; cursor: pointer;
          background: light-dark(#fafaf8, #2a2a31); color: inherit; text-align: center; }
  button.primary { background: #4a5568; border-color: #4a5568; color: #fff; }
  .err { font-size: 13px; color: light-dark(#b42318, #ff8a80); margin-top: 14px; white-space: pre-wrap; }
  .muted { font-size: 12.5px; opacity: .6; margin-top: 16px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="card">
  <h1 id="title">Sign in</h1>
  <p class="org">${orgName}</p>
  <div id="signin" hidden></div>
  <div id="consent" hidden>
    <p class="ask" id="ask"></p>
    <button class="primary" id="approve">Approve</button>
    <button id="deny">Deny</button>
  </div>
  <p class="muted" id="status">Loading…</p>
  <p class="err" id="error" hidden></p>
</div>
<script>
(() => {
  const CFG = ${cfg};
  const $ = (id) => document.getElementById(id);
  const authorizationId = new URLSearchParams(location.search).get('authorization_id');
  const fail = (msg) => { $('status').hidden = true; $('error').hidden = false; $('error').textContent = msg; };

  // A session returning from a social sign-in arrives in the URL fragment.
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (fragment.get('access_token')) {
    sessionStorage.setItem('harbor-consent-session', fragment.get('access_token'));
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (fragment.get('error_description')) return fail('Sign-in failed: ' + fragment.get('error_description'));
  if (!authorizationId) return fail('Missing authorization_id — this page is only reached from an OAuth authorize redirect.');

  const session = () => sessionStorage.getItem('harbor-consent-session');
  const api = async (path, init) => {
    const res = await fetch(CFG.issuer + path, {
      ...init,
      headers: { apikey: CFG.apikey, authorization: 'Bearer ' + session(), 'content-type': 'application/json', ...(init && init.headers) },
    });
    if (res.status === 401 || res.status === 403) { sessionStorage.removeItem('harbor-consent-session'); await showSignin(); return null; }
    if (!res.ok) throw new Error('AS returned ' + res.status + ': ' + await res.text());
    return res.json();
  };

  async function showSignin() {
    $('title').textContent = 'Sign in to continue';
    $('consent').hidden = true; $('signin').hidden = false; $('status').hidden = true;
    if ($('signin').childElementCount) return;
    // Derive the buttons from what THIS project actually has enabled.
    const res = await fetch(CFG.issuer + '/settings', { headers: { apikey: CFG.apikey } });
    if (!res.ok) return fail('Could not read the authorization server settings (' + res.status + ').');
    const external = (await res.json()).external || {};
    const providers = Object.keys(external).filter((id) => external[id] === true && !CFG.nonSocial.includes(id));
    if (!providers.length) return fail('No social sign-in providers are enabled on this org\\'s authorization server.');
    for (const id of providers) {
      const a = document.createElement('a');
      a.className = 'btn';
      a.textContent = 'Continue with ' + (CFG.labels[id] || id.charAt(0).toUpperCase() + id.slice(1));
      const back = location.origin + location.pathname + '?authorization_id=' + encodeURIComponent(authorizationId);
      a.href = CFG.issuer + '/authorize?provider=' + id + '&redirect_to=' + encodeURIComponent(back);
      $('signin').appendChild(a);
    }
  }

  async function run() {
    if (!session()) return showSignin();
    // The claim step is mandatory: consent 404s unless details were fetched first.
    const details = await api('/oauth/authorizations/' + encodeURIComponent(authorizationId));
    if (!details) return; // 401 → sign-in shown
    const client = (details.client && (details.client.name || details.client.client_name || details.client.client_id))
      || details.client_name || details.client_id || 'An application';
    const scope = details.scope || (details.authorization && details.authorization.scope) || '';
    $('title').textContent = 'Authorize access';
    $('ask').innerHTML = '<b></b> wants access to your account' + (scope ? ' (scope: ' + escapeText(scope) + ')' : '') + '.';
    $('ask').querySelector('b').textContent = client;
    $('signin').hidden = true; $('consent').hidden = false; $('status').hidden = true;
    const decide = (action) => async () => {
      $('approve').disabled = $('deny').disabled = true;
      try {
        const out = await api('/oauth/authorizations/' + encodeURIComponent(authorizationId) + '/consent', {
          method: 'POST', body: JSON.stringify({ action }),
        });
        if (!out) return;
        sessionStorage.removeItem('harbor-consent-session');
        const to = out.redirect_to || out.redirect_url;
        if (to) location.href = to; else fail('The authorization server returned no redirect.');
      } catch (e) { fail(String(e && e.message || e)); }
    };
    $('approve').onclick = decide('approve');
    $('deny').onclick = decide('deny');
  }

  const escapeText = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  run().catch((e) => fail(String(e && e.message || e)));
})();
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
