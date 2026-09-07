import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { WorkDir } from "@x/core/dist/config/config.js";
import type { ipc } from "@x/shared";
import { dispatchDeepLink } from "./deeplink.js";
import {
  getQuickAskShortcutState,
  onQuickAskShortcutChanged,
  toggleQuickAsk,
} from "./quick-ask.js";
import {
  checkForUpdates,
  getUpdaterStatus,
  onUpdaterStatusChanged,
  quitAndInstallUpdate,
} from "./updater.js";
import { zoomIn, zoomOut, zoomReset } from "./zoom.js";

/**
 * Native application menu (File / Edit / View / Go / Tools / Window / Help).
 *
 * Until this module existed the app ran on Electron's factory-default menu:
 * Help pointed at electronjs.org and Reload / Toggle Developer Tools shipped
 * enabled in production. The menu here mirrors the tray's structure
 * (tray.ts): a static template rebuilt whenever dynamic state changes —
 * recording on/off, quick-ask chord rebinds, updater transitions.
 *
 * Commands land in the renderer over two channels: `menu:command` (one
 * discriminated payload for everything the renderer owns) and
 * `menu:toggleSidebar` (its own channel — the handler must live inside the
 * SidebarProvider). Go-menu navigation instead rides the existing deep-link
 * pipeline (dispatchDeepLink → app:openUrl / pending-link drain), which
 * already parks URLs while the renderer loads and covers every section.
 *
 * Accelerator ownership: chords the renderer already handles via document
 * keydown (⌘K, ⌘N, ⌘L, ⌘Z/⇧⌘Z) are display-only here on Windows/Linux
 * (`registerAccelerator: false`) so those handlers keep receiving the keys;
 * on macOS the page gets first chance at a chord and those handlers call
 * preventDefault, so behavior is identical either way. Zoom keystrokes stay
 * in zoom.ts's before-input-event hook (see the comment there).
 */

const REPO_URL = "https://github.com/rowboatlabs/rowboat";

type MenuCommand = ipc.IPCChannels["menu:command"]["req"];

interface MenuActions {
  openApp: () => void;
  getMainWindow: () => BrowserWindow | null;
  toggleMeetingNotes: () => void;
}

let actions: MenuActions | null = null;
let recording = false;

export function installAppMenu(menuActions: MenuActions): void {
  actions = menuActions;
  rebuildMenu();
  onQuickAskShortcutChanged(() => rebuildMenu());
  onUpdaterStatusChanged(() => rebuildMenu());
}

/** Mirror of setTrayRecordingState — both surfaces relabel together. */
export function setMenuRecordingState(isRecording: boolean): void {
  if (recording === isRecording) return;
  recording = isRecording;
  rebuildMenu();
}

/**
 * Deliver a renderer-owned command, revealing the window first (on macOS the
 * app menu is reachable with no window at all). A still-loading renderer gets
 * it after did-finish-load — same pattern as the meeting popup in main.ts.
 */
function sendToRenderer(channel: "menu:command" | "menu:toggleSidebar", payload: MenuCommand | null): void {
  if (!actions) return;
  actions.openApp();
  const win = actions.getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    });
    return;
  }
  win.webContents.send(channel, payload);
}

function sendCommand(payload: MenuCommand): void {
  sendToRenderer("menu:command", payload);
}

/**
 * Go-menu navigation rides the deep-link pipeline — parseDeepLink in the
 * renderer covers every section and dispatchDeepLink parks the URL while the
 * renderer loads, so the menu needs no navigation channel of its own.
 */
function navigate(type: string): void {
  actions?.openApp();
  dispatchDeepLink(`rowboat://open?type=${type}`);
}

function withMainWindow(fn: (win: BrowserWindow) => void): void {
  const win = actions?.getMainWindow();
  if (win && !win.isDestroyed()) fn(win);
}

function showAboutDialog(): void {
  sendCommand({ command: "open-about" });
}

/** "Check for Updates…" in the state the updater is actually in. */
function updateMenuItem(): MenuItemConstructorOptions {
  const status = getUpdaterStatus();
  switch (status.state) {
    case "checking":
      return { label: "Checking for Updates…", enabled: false };
    case "downloading":
      return { label: "Downloading Update…", enabled: false };
    case "ready":
      return {
        label: `Restart to Update${status.newVersion ? ` to v${status.newVersion}` : ""}`,
        click: () => quitAndInstallUpdate(),
      };
    case "disabled":
      // Dev build — nothing to check against.
      return { label: "Check for Updates…", enabled: false };
    case "unsupported":
      // Linux (deb/zip installs) and macOS outside /Applications have no
      // auto-update path — point at the releases page instead.
      return {
        label: "Check for Updates on GitHub…",
        click: () => void shell.openExternal(`${REPO_URL}/releases`),
      };
    default:
      return { label: "Check for Updates…", click: () => void checkForUpdates() };
  }
}

/** Ordered as the dock is. Number keys cover its nine primary destinations. */
const GO_ITEMS: ReadonlyArray<{ label: string; type: string; accelerator?: string }> = [
  { label: "Home", type: "home", accelerator: "CmdOrCtrl+1" },
  { label: "Spaces", type: "spaces", accelerator: "CmdOrCtrl+2" },
  { label: "Email", type: "email", accelerator: "CmdOrCtrl+3" },
  { label: "Code", type: "code", accelerator: "CmdOrCtrl+4" },
  { label: "Meetings", type: "meetings", accelerator: "CmdOrCtrl+5" },
  { label: "Brain", type: "knowledge-view", accelerator: "CmdOrCtrl+6" },
  { label: "Apps", type: "apps", accelerator: "CmdOrCtrl+7" },
  { label: "Background Agents", type: "bg-tasks", accelerator: "CmdOrCtrl+8" },
  { label: "Workspaces", type: "workspace", accelerator: "CmdOrCtrl+9" },
  { label: "Chat History", type: "chat-history" },
  { label: "Live Notes", type: "live-notes" },
  { label: "Graph", type: "graph" },
];

function rebuildMenu(): void {
  const isMac = process.platform === "darwin";

  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => sendCommand({ command: "open-settings" }),
  };

  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { label: "About Rowboat", click: () => showAboutDialog() },
      { type: "separator" },
      settingsItem,
      updateMenuItem(),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "New Chat",
        accelerator: "CmdOrCtrl+N",
        registerAccelerator: false,
        click: () => sendCommand({ command: "new-chat" }),
      },
      {
        label: "New Note",
        accelerator: "CmdOrCtrl+Shift+N",
        click: () => sendCommand({ command: "new-note" }),
      },
      {
        label: "New Presentation…",
        click: () => sendCommand({ command: "new-presentation" }),
      },
      { type: "separator" },
      {
        label: "Export Note",
        submenu: [
          { label: "Markdown (.md)", click: () => sendCommand({ command: "export-note", format: "md" }) },
          { label: "PDF (.pdf)", click: () => sendCommand({ command: "export-note", format: "pdf" }) },
          { label: "Word (.docx)", click: () => sendCommand({ command: "export-note", format: "docx" }) },
        ],
      },
      { type: "separator" },
      ...(isMac ? [] : [settingsItem, { type: "separator" } as MenuItemConstructorOptions]),
      { role: "close" },
      ...(isMac ? [] : [{ role: "quit" } as MenuItemConstructorOptions]),
    ],
  };

  // macOS keeps the standard roles — clipboard and undo in native inputs are
  // menu-driven there, and the renderer's markdown history routing already
  // preempts ⌘Z when it applies (exactly as with the old default menu).
  // Windows/Linux route undo/redo through the renderer instead, display-only
  // accelerators, so the document-level handlers keep owning the keystrokes.
  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: isMac
      ? [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ]
      : [
          {
            label: "Undo",
            accelerator: "CmdOrCtrl+Z",
            registerAccelerator: false,
            click: () => sendCommand({ command: "undo" }),
          },
          {
            label: "Redo",
            accelerator: "CmdOrCtrl+Shift+Z",
            registerAccelerator: false,
            click: () => sendCommand({ command: "redo" }),
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "delete" },
          { role: "selectAll" },
        ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      {
        label: "Search…",
        accelerator: "CmdOrCtrl+K",
        registerAccelerator: false,
        click: () => sendCommand({ command: "open-search" }),
      },
      { type: "separator" },
      {
        label: "Toggle Sidebar",
        accelerator: "CmdOrCtrl+\\",
        click: () => sendToRenderer("menu:toggleSidebar", null),
      },
      {
        label: "Toggle Browser",
        click: () => sendCommand({ command: "toggle-browser" }),
      },
      {
        label: "Full-Screen Chat",
        accelerator: "CmdOrCtrl+L",
        registerAccelerator: false,
        click: () => sendCommand({ command: "toggle-full-screen-chat" }),
      },
      { type: "separator" },
      // Display-only in effect: the keystrokes are consumed (and the menu
      // accelerators suppressed) by zoom.ts's before-input-event hook.
      { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => withMainWindow(zoomIn) },
      { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => withMainWindow(zoomOut) },
      { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => withMainWindow(zoomReset) },
      { type: "separator" },
      { role: "togglefullscreen" },
      // Chromium debugging stays out of production builds.
      ...(app.isPackaged
        ? []
        : [
            { type: "separator" } as MenuItemConstructorOptions,
            { role: "reload" } as MenuItemConstructorOptions,
            { role: "forceReload" } as MenuItemConstructorOptions,
            { role: "toggleDevTools" } as MenuItemConstructorOptions,
          ]),
    ],
  };

  const goMenu: MenuItemConstructorOptions = {
    label: "Go",
    submenu: [
      {
        label: "Back",
        accelerator: isMac ? "Cmd+[" : "Alt+Left",
        click: () => sendCommand({ command: "go-back" }),
      },
      {
        label: "Forward",
        accelerator: isMac ? "Cmd+]" : "Alt+Right",
        click: () => sendCommand({ command: "go-forward" }),
      },
      { type: "separator" },
      ...GO_ITEMS.map((item): MenuItemConstructorOptions => ({
        label: item.label,
        ...(item.accelerator ? { accelerator: item.accelerator } : {}),
        click: () => navigate(item.type),
      })),
    ],
  };

  const toolsMenu: MenuItemConstructorOptions = {
    label: "Tools",
    submenu: [
      // The accelerator renders next to the label (display only; the real
      // binding is the globalShortcut in quick-ask.ts). Hidden while the
      // chord is unregistered — showing a dead chord would lie.
      {
        label: "Quick Ask",
        ...(getQuickAskShortcutState().registered
          ? { accelerator: getQuickAskShortcutState().accelerator }
          : {}),
        registerAccelerator: false,
        click: () => toggleQuickAsk(),
      },
      recording
        ? {
            label: "Stop Recording and Generate Notes",
            click: () => actions?.toggleMeetingNotes(),
          }
        : {
            label: "Start Meeting Notes",
            click: () => actions?.toggleMeetingNotes(),
          },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = isMac
    ? { role: "windowMenu" }
    : { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      { label: "Rowboat on GitHub", click: () => void shell.openExternal(REPO_URL) },
      { label: "Report an Issue…", click: () => void shell.openExternal(`${REPO_URL}/issues/new`) },
      { label: "Release Notes", click: () => void shell.openExternal(`${REPO_URL}/releases`) },
      { type: "separator" },
      {
        label: "Keyboard Shortcuts…",
        click: () => sendCommand({ command: "open-settings", tab: "shortcuts" }),
      },
      // ~/.rowboat — configs, caches, synced calendars; the place support
      // asks people to look, now one click away.
      { label: "Open Data Folder", click: () => void shell.openPath(WorkDir) },
      ...(isMac
        ? []
        : [
            { type: "separator" } as MenuItemConstructorOptions,
            updateMenuItem(),
            { label: "About Rowboat", click: () => showAboutDialog() } as MenuItemConstructorOptions,
          ]),
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    goMenu,
    toolsMenu,
    windowMenu,
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
