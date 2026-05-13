import type { BrowserPageElement } from '@x/shared/dist/browser-control.js';

const INTERACTABLE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const CLICKABLE_TARGET_SELECTORS = [
  'a[href]',
  'button',
  'summary',
  'label',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[aria-pressed]',
  '[aria-expanded]',
  '[aria-checked]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const DOM_HELPERS_SOURCE = String.raw`
const truncateText = (value, max) => {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  const safeMax = Math.max(0, max - 3);
  return normalized.slice(0, safeMax).trim() + '...';
};

const cssEscapeValue = (value) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\' + char);
};

const isVisibleElement = (element) => {
  if (!(element instanceof Element)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  if (element.getAttribute('aria-hidden') === 'true') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const isDisabledElement = (element) => {
  if (!(element instanceof Element)) return true;
  if (element.getAttribute('aria-disabled') === 'true') return true;
  return 'disabled' in element && Boolean(element.disabled);
};

const isUselessClickTarget = (element) => (
  element === document.body
  || element === document.documentElement
);

const getElementRole = (element) => {
  const explicitRole = element.getAttribute('role');
  if (explicitRole) return explicitRole;
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLInputElement) return element.type === 'checkbox' ? 'checkbox' : 'input';
  if (element instanceof HTMLTextAreaElement) return 'textbox';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLElement && element.isContentEditable) return 'textbox';
  return null;
};

const getElementType = (element) => {
  if (element instanceof HTMLInputElement) return element.type || 'text';
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLButtonElement) return 'button';
  if (element instanceof HTMLElement && element.isContentEditable) return 'contenteditable';
  return null;
};

const isTextEntryElement = (element) => (
  element instanceof HTMLInputElement
  || element instanceof HTMLTextAreaElement
  || (element instanceof HTMLElement && element.isContentEditable)
);

const shouldRedactVerificationValue = (element) => (
  element instanceof HTMLInputElement
    ? !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes((element.type || '').toLowerCase())
    : element instanceof HTMLTextAreaElement
      || (element instanceof HTMLElement && element.isContentEditable)
);

const getElementLabel = (element) => {
  const ariaLabel = truncateText(element.getAttribute('aria-label') ?? '', 120);
  if (ariaLabel) return ariaLabel;

  if ('labels' in element && element.labels && element.labels.length > 0) {
    const labelText = truncateText(
      Array.from(element.labels).map((label) => label.innerText || label.textContent || '').join(' '),
      120,
    );
    if (labelText) return labelText;
  }

  if (element.id) {
    const label = document.querySelector('label[for="' + cssEscapeValue(element.id) + '"]');
    const labelText = truncateText(label?.textContent ?? '', 120);
    if (labelText) return labelText;
  }

  const placeholder = truncateText(element.getAttribute('placeholder') ?? '', 120);
  if (placeholder) return placeholder;

  if (isTextEntryElement(element)) {
    return null;
  }

  const text = truncateText(
    element.textContent ?? '',
    120,
  );
  return text || null;
};

const describeElement = (element) => {
  const role = getElementRole(element) || element.tagName.toLowerCase();
  const label = getElementLabel(element);
  return label ? role + ' "' + label + '"' : role;
};

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const getAssociatedControl = (element) => {
  if (!(element instanceof Element)) return null;
  if (element instanceof HTMLLabelElement) return element.control;
  const parentLabel = element.closest('label');
  return parentLabel instanceof HTMLLabelElement ? parentLabel.control : null;
};

const resolveClickTarget = (element) => {
  if (!(element instanceof Element)) return null;

  const clickableAncestor = element.closest(${JSON.stringify(CLICKABLE_TARGET_SELECTORS)});
  const labelAncestor = element.closest('label');
  const associatedControl = getAssociatedControl(element);
  const candidates = [clickableAncestor, labelAncestor, associatedControl, element];

  for (const candidate of candidates) {
    if (!(candidate instanceof Element)) continue;
    if (isUselessClickTarget(candidate)) continue;
    if (!isVisibleElement(candidate)) continue;
    if (isDisabledElement(candidate)) continue;
    return candidate;
  }

  for (const candidate of candidates) {
    if (candidate instanceof Element) return candidate;
  }

  return null;
};

const getVerificationTargetState = (element) => {
  if (!(element instanceof Element)) return null;

  const text = truncateText(element.innerText || element.textContent || '', 200);
  const activeElement = document.activeElement;
  const isActive =
    activeElement instanceof Element
      ? activeElement === element || element.contains(activeElement)
      : false;

  return {
    selector: buildUniqueSelector(element),
    descriptor: describeElement(element),
    text: text || null,
    checked:
      element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
        ? element.checked
        : null,
    value:
      shouldRedactVerificationValue(element)
        ? null
        : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? truncateText(element.value ?? '', 200)
        : element instanceof HTMLSelectElement
          ? truncateText(element.value ?? '', 200)
          : element instanceof HTMLElement && element.isContentEditable
            ? truncateText(element.innerText || element.textContent || '', 200)
            : null,
    selectedIndex: element instanceof HTMLSelectElement ? element.selectedIndex : null,
    open:
      'open' in element && typeof element.open === 'boolean'
        ? element.open
        : null,
    disabled: isDisabledElement(element),
    active: isActive,
    ariaChecked: element.getAttribute('aria-checked'),
    ariaPressed: element.getAttribute('aria-pressed'),
    ariaExpanded: element.getAttribute('aria-expanded'),
  };
};

const getPageVerificationState = () => {
  const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
  return {
    url: window.location.href,
    title: document.title || '',
    textSample: truncateText(document.body?.innerText || document.body?.textContent || '', 2000),
    activeSelector: activeElement ? buildUniqueSelector(activeElement) : null,
  };
};

const buildUniqueSelector = (element) => {
  if (!(element instanceof Element)) return null;

  if (element.id) {
    const idSelector = '#' + cssEscapeValue(element.id);
    try {
      if (document.querySelectorAll(idSelector).length === 1) return idSelector;
    } catch {}
  }

  const segments = [];
  let current = element;
  while (current && current instanceof Element && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    if (!tag) break;

    let segment = tag;
    const name = current.getAttribute('name');
    if (name) {
      const nameSelector = tag + '[name="' + cssEscapeValue(name) + '"]';
      try {
        if (document.querySelectorAll(nameSelector).length === 1) {
          segments.unshift(nameSelector);
          return segments.join(' > ');
        }
      } catch {}
    }

    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const position = sameTagSiblings.indexOf(current) + 1;
      segment += ':nth-of-type(' + position + ')';
    }

    segments.unshift(segment);
    const selector = segments.join(' > ');
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch {}

    current = current.parentElement;
  }

  return segments.length > 0 ? segments.join(' > ') : null;
};
`;

type RawBrowserPageElement = BrowserPageElement & {
  selector: string;
};

export type RawBrowserPageSnapshot = {
  url: string;
  title: string;
  loading: boolean;
  text: string;
  elements: RawBrowserPageElement[];
};

export type ElementTarget = {
  index?: number;
  selector?: string;
  snapshotId?: string;
};

export function buildReadPageScript(maxElements: number, maxTextLength: number): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const candidates = Array.from(document.querySelectorAll(${JSON.stringify(INTERACTABLE_SELECTORS)}));
    const elements = [];
    const seenSelectors = new Set();

    for (const candidate of candidates) {
      if (!(candidate instanceof Element)) continue;
      if (!isVisibleElement(candidate)) continue;

      const selector = buildUniqueSelector(candidate);
      if (!selector || seenSelectors.has(selector)) continue;
      seenSelectors.add(selector);

      elements.push({
        index: elements.length + 1,
        selector,
        tagName: candidate.tagName.toLowerCase(),
        role: getElementRole(candidate),
        type: getElementType(candidate),
        label: getElementLabel(candidate),
        text: truncateText(candidate.innerText || candidate.textContent || '', 120) || null,
        placeholder: truncateText(candidate.getAttribute('placeholder') ?? '', 120) || null,
        href: candidate instanceof HTMLAnchorElement ? candidate.href : candidate.getAttribute('href'),
        disabled: isDisabledElement(candidate),
      });

      if (elements.length >= ${JSON.stringify(maxElements)}) break;
    }

    return {
      url: window.location.href,
      title: document.title || '',
      loading: document.readyState !== 'complete',
      text: truncateText(document.body?.innerText || document.body?.textContent || '', ${JSON.stringify(maxTextLength)}),
      elements,
    };
  })()`;
}

export function buildClickScript(selector: string): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const requestedSelector = ${JSON.stringify(selector)};
    if (/^(body|html)$/i.test(requestedSelector.trim())) {
      return {
        ok: false,
        error: 'Refusing to click the page body. Read the page again and target a specific element.',
      };
    }

    const element = document.querySelector(requestedSelector);
    if (!(element instanceof Element)) {
      return { ok: false, error: 'Element not found.' };
    }
    if (isUselessClickTarget(element)) {
      return {
        ok: false,
        error: 'Refusing to click the page body. Read the page again and target a specific element.',
      };
    }

    const target = resolveClickTarget(element);
    if (!(target instanceof Element)) {
      return { ok: false, error: 'Could not resolve a clickable target.' };
    }
    if (isUselessClickTarget(target)) {
      return {
        ok: false,
        error: 'Resolved click target was too generic. Read the page again and choose a specific control.',
      };
    }
    if (!isVisibleElement(target)) {
      return { ok: false, error: 'Resolved click target is not visible.' };
    }
    if (isDisabledElement(target)) {
      return { ok: false, error: 'Resolved click target is disabled.' };
    }

    const before = {
      page: getPageVerificationState(),
      target: getVerificationTargetState(target),
    };

    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.focus({ preventScroll: true });
    }

    const rect = target.getBoundingClientRect();
    const clientX = clampNumber(rect.left + (rect.width / 2), 1, Math.max(1, window.innerWidth - 1));
    const clientY = clampNumber(rect.top + (rect.height / 2), 1, Math.max(1, window.innerHeight - 1));
    const topElement = document.elementFromPoint(clientX, clientY);
    const eventTarget =
      topElement instanceof Element && (topElement === target || topElement.contains(target) || target.contains(topElement))
        ? topElement
        : target;

    if (eventTarget instanceof HTMLElement) {
      eventTarget.focus({ preventScroll: true });
    }

    return {
      ok: true,
      description: describeElement(target),
      clickPoint: {
        x: Math.round(clientX),
        y: Math.round(clientY),
      },
      verification: {
        before,
        targetSelector: buildUniqueSelector(target) || requestedSelector,
      },
    };
  })()`;
}

export function buildVerifyClickScript(targetSelector: string | null, before: unknown): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const beforeState = ${JSON.stringify(before)};
    const selector = ${JSON.stringify(targetSelector)};
    const afterPage = getPageVerificationState();
    const afterTarget = selector ? getVerificationTargetState(document.querySelector(selector)) : null;
    const beforeTarget = beforeState?.target ?? null;
    const reasons = [];

    if (beforeState?.page?.url !== afterPage.url) reasons.push('url changed');
    if (beforeState?.page?.title !== afterPage.title) reasons.push('title changed');
    if (beforeState?.page?.textSample !== afterPage.textSample) reasons.push('page text changed');
    if (beforeState?.page?.activeSelector !== afterPage.activeSelector) reasons.push('focus changed');

    if (beforeTarget && !afterTarget) {
      reasons.push('clicked element disappeared');
    }

    if (beforeTarget && afterTarget) {
      if (beforeTarget.checked !== afterTarget.checked) reasons.push('checked state changed');
      if (beforeTarget.value !== afterTarget.value) reasons.push('value changed');
      if (beforeTarget.selectedIndex !== afterTarget.selectedIndex) reasons.push('selection changed');
      if (beforeTarget.open !== afterTarget.open) reasons.push('open state changed');
      if (beforeTarget.disabled !== afterTarget.disabled) reasons.push('disabled state changed');
      if (beforeTarget.active !== afterTarget.active) reasons.push('target focus changed');
      if (beforeTarget.ariaChecked !== afterTarget.ariaChecked) reasons.push('aria-checked changed');
      if (beforeTarget.ariaPressed !== afterTarget.ariaPressed) reasons.push('aria-pressed changed');
      if (beforeTarget.ariaExpanded !== afterTarget.ariaExpanded) reasons.push('aria-expanded changed');
      if (beforeTarget.text !== afterTarget.text) reasons.push('target text changed');
    }

    return {
      changed: reasons.length > 0,
      reasons,
    };
  })()`;
}

export function buildTypeScript(selector: string, text: string): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof Element)) {
      return { ok: false, error: 'Element not found.' };
    }
    if (!isVisibleElement(element)) {
      return { ok: false, error: 'Element is not visible.' };
    }
    if (isDisabledElement(element)) {
      return { ok: false, error: 'Element is disabled.' };
    }

    const nextValue = ${JSON.stringify(text)};

    const setNativeValue = (target, value) => {
      const prototype = Object.getPrototypeOf(target);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(target, value);
      } else {
        target.value = value;
      }
    };

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.readOnly) {
        return { ok: false, error: 'Element is read-only.' };
      }
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
      setNativeValue(element, nextValue);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextValue, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, description: describeElement(element) };
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
      element.textContent = nextValue;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: nextValue, inputType: 'insertText' }));
      return { ok: true, description: describeElement(element) };
    }

    return { ok: false, error: 'Element does not accept text input.' };
  })()`;
}

export function buildFocusScript(selector: string): string {
  return `(() => {
    ${DOM_HELPERS_SOURCE}
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof Element)) {
      return { ok: false, error: 'Element not found.' };
    }
    if (!isVisibleElement(element)) {
      return { ok: false, error: 'Element is not visible.' };
    }
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus({ preventScroll: true });
    }
    return { ok: true, description: describeElement(element) };
  })()`;
}

export function buildScrollScript(offset: number): string {
  return `(() => {
    window.scrollBy({ top: ${JSON.stringify(offset)}, left: 0, behavior: 'auto' });
    return { ok: true };
  })()`;
}

export function normalizeKeyCode(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'Enter';

  const aliases: Record<string, string> = {
    esc: 'Escape',
    escape: 'Escape',
    return: 'Enter',
    enter: 'Enter',
    tab: 'Tab',
    space: 'Space',
    ' ': 'Space',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    backspace: 'Backspace',
    delete: 'Delete',
  };

  const alias = aliases[trimmed.toLowerCase()];
  if (alias) return alias;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}
