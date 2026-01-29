const DEBOUNCE_MS = 800;
const MIN_SCROLL_PIXELS = 500;
const MIN_CONTENT_CHANGE = 100; // characters

let debounceTimer = null;
let lastCapturedContent = null;
let lastScrollTop = 0;
let scrollContainer = null;

function getScrollTop() {
  if (!scrollContainer || scrollContainer === window) {
    return window.scrollY;
  }
  if (scrollContainer === document) {
    return document.documentElement.scrollTop;
  }
  return scrollContainer.scrollTop || 0;
}

function captureAndSend() {
  const content = document.body.innerText;

  // Skip if content unchanged or minimal change
  if (lastCapturedContent) {
    const lengthDiff = Math.abs(content.length - lastCapturedContent.length);
    if (content === lastCapturedContent || lengthDiff < MIN_CONTENT_CHANGE) {
      return;
    }
  }

  lastCapturedContent = content;
  lastScrollTop = getScrollTop();

  chrome.runtime.sendMessage({
    type: 'SCROLL_CAPTURE',
    url: window.location.href,
    title: document.title,
    content: content,
    timestamp: Date.now(),
    scrollY: lastScrollTop
  });
}

function onScroll() {
  const currentScrollTop = getScrollTop();
  const scrollDelta = Math.abs(currentScrollTop - lastScrollTop);

  if (scrollDelta < MIN_SCROLL_PIXELS) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    captureAndSend();
  }, DEBOUNCE_MS);
}

function init() {
  // Use document with capture to catch scroll events from any element
  document.addEventListener('scroll', (e) => {
    const target = e.target;
    const scrollTop = target === document ? document.documentElement.scrollTop : target.scrollTop;

    // Update scroll container if we found the real one
    if (scrollTop > 0 && scrollContainer !== target) {
      scrollContainer = target;
    }

    onScroll();
  }, { capture: true, passive: true });
}

// Wait for page to be ready, then init
if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}
