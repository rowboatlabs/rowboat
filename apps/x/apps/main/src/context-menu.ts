import { BrowserWindow, clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from "electron";

/**
 * Native right-click menu for text editing and selections.
 *
 * Electron shows no context menu by default, so without this, right-clicking
 * an input, the note editor, or selected text does nothing. The renderer's
 * in-DOM Radix menus call preventDefault() on contextmenu, which suppresses
 * this event entirely — so the two never fight: DOM menus win wherever they
 * exist, and this handler covers everything they don't (cut/copy/paste,
 * spellcheck suggestions, link copying).
 */
export function attachTextEditContextMenu(wc: WebContents): void {
  wc.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          click: () => wc.replaceMisspelling(suggestion),
        });
      }
      template.push({
        label: "Add to Dictionary",
        click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      template.push({ type: "separator" });
    }

    if (params.isEditable) {
      template.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      template.push({ role: "copy" });
    }

    if (params.linkURL) {
      if (template.length > 0) template.push({ type: "separator" });
      template.push({
        label: "Copy Link Address",
        click: () => clipboard.writeText(params.linkURL),
      });
    }

    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(wc) ?? undefined,
    });
  });
}
