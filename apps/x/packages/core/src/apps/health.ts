// Installed before app scripts so synchronous startup failures are observable.
// Only status/error text is sent; never data payloads or request arguments.
export const HEALTH_BOOTSTRAP = String.raw`<script>
(() => {
  const report = (state, message) => {
    if (window.parent !== window) window.parent.postMessage({ type: 'rowboat:app-health', state, message }, '*');
  };
  report('loading');
  let fatalError = false;
  let documentLoaded = false;
  const requestErrors = new Set();
  const healthy = () => { if (documentLoaded && !fatalError && !requestErrors.size) report('loaded'); };
  const fail = (message, requestPath) => {
    if (requestPath) requestErrors.add(requestPath); else fatalError = true;
    report('error', String(message).slice(0, 1000));
  };
  window.addEventListener('error', (event) => {
    if (event.target !== window) {
      if (event.target?.tagName === 'SCRIPT') fail('A script required by this app could not load.');
    } else fail('The app encountered a JavaScript error. Ask the copilot to check its scripts.');
  }, true);
  window.addEventListener('unhandledrejection', () => fail('An app operation failed. Retry, or ask the copilot to inspect the app.'));
  const originalFetch = window.fetch;
  if (originalFetch) window.fetch = async function(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const hostRequest = url.origin === location.origin && url.pathname.startsWith('/_rowboat/');
    try {
      const response = await originalFetch.call(this, input, init);
      if (hostRequest && !response.ok) fail(response.status === 401 || response.status === 403
        ? 'The app needs an account connection or permission. Ask the copilot to finish setup.'
        : 'An app data request failed (' + response.status + '). Retry the update or ask the copilot to fix it.', url.pathname);
      if (hostRequest && response.ok && requestErrors.delete(url.pathname)) healthy();
      return response;
    } catch (error) {
      if (hostRequest) fail('The app could not reach its data service.', url.pathname);
      throw error;
    }
  };
  window.addEventListener('load', () => { documentLoaded = true; healthy(); }, { once: true });
})();
</script>`;

