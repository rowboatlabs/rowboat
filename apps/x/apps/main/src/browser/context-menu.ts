import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';

export function buildBrowserContextMenu(
  wc: WebContents,
  params: ContextMenuParams,
  actions: { openTab: (url: string) => void; copyText: (text: string) => void },
): MenuItemConstructorOptions[] {
  const menu: MenuItemConstructorOptions[] = [];
  // Keep commands bound to the original contents even if the active tab changes.
  const command = (run: () => void) => () => {
    if (wc.isDestroyed()) return;
    wc.focus();
    run();
  };
  const group = (items: MenuItemConstructorOptions[]) => {
    if (menu.length) menu.push({ type: 'separator' });
    menu.push(...items);
  };
  const canOpen = (url: string) => /^https?:\/\//i.test(url);
  const canSaveImage = (url: string) => canOpen(url) || /^blob:https?:\/\//i.test(url) || /^data:image\//i.test(url);
  const { editFlags } = params;

  if (params.isEditable) {
    group([
      { label: 'Undo', enabled: editFlags.canUndo, click: command(() => wc.undo()) },
      { label: 'Redo', enabled: editFlags.canRedo, click: command(() => wc.redo()) },
    ]);
    group([
      { label: 'Cut', enabled: editFlags.canCut, click: command(() => wc.cut()) },
      { label: 'Copy', enabled: editFlags.canCopy, click: command(() => wc.copy()) },
      { label: 'Paste', enabled: editFlags.canPaste, click: command(() => wc.paste()) },
      { label: 'Paste as plain text', enabled: editFlags.canPaste, click: command(() => wc.pasteAndMatchStyle()) },
      { label: 'Select all', enabled: editFlags.canSelectAll, click: command(() => wc.selectAll()) },
    ]);
  } else if (params.selectionText) {
    group([{ label: 'Copy', enabled: editFlags.canCopy, click: () => actions.copyText(params.selectionText) }]);
  }

  if (params.linkURL) {
    group([
      { label: 'Open link in new tab', enabled: canOpen(params.linkURL), click: () => {
        if (canOpen(params.linkURL)) actions.openTab(params.linkURL);
      } },
      { label: 'Copy link address', click: () => actions.copyText(params.linkURL) },
    ]);
  }

  if (params.mediaType === 'image') {
    group([
      { label: 'Open image in new tab', enabled: canOpen(params.srcURL), click: () => {
        if (canOpen(params.srcURL)) actions.openTab(params.srcURL);
      } },
      { label: 'Save image as…', enabled: canSaveImage(params.srcURL), click: command(() => {
        // Download through the originating page's session. Electron supplies the
        // native save dialog and preserves the original image format.
        if (canSaveImage(params.srcURL)) wc.downloadURL(params.srcURL);
      }) },
      { label: 'Copy image', enabled: params.hasImageContents, click: command(() => wc.copyImageAt(params.x, params.y)) },
      { label: 'Copy image address', enabled: !!params.srcURL, click: () => actions.copyText(params.srcURL) },
    ]);
  }

  if (!params.isEditable && !params.selectionText && !params.linkURL && params.mediaType === 'none') {
    group([
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: command(() => {
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      }) },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: command(() => {
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      }) },
      { label: 'Reload', click: command(() => wc.reload()) },
    ]);
  }
  group([{ label: 'Copy page address', click: () => actions.copyText(params.pageURL) }]);
  return menu;
}
