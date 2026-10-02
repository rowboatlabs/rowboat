// The main process in French (decided 02/10/2026): the menu bar, the tray,
// notifications and the system's dialogs, which the renderer's layer cannot
// reach. Same rule as there (translate.ts): the upstream files stay as they
// are; scripts/brand.mjs copies this file and adds one line to main.ts that
// wraps the few Electron calls that show text. Whatever fails here leaves
// the text English, never the app stopped.
import { FR } from './fr.js';
import { type Dictionary, pickLang, translate } from './translate.js';

/** Words a menu bar says differently from a screen (« Édition », not « Modifier »). */
const MENU: Record<string, string> = {
  File: 'Fichier',
  Edit: 'Édition',
  View: 'Présentation',
  Go: 'Aller',
  Tools: 'Outils',
  Window: 'Fenêtre',
  Help: 'Aide',
  Back: 'Précédent',
  Forward: 'Suivant',
  Undo: 'Annuler',
  Redo: 'Rétablir',
  Cut: 'Couper',
  Copy: 'Copier',
  Paste: 'Coller',
  'Paste as plain text': 'Coller en texte brut',
  'Select all': 'Tout sélectionner',
  'Open link in new tab': 'Ouvrir le lien dans un nouvel onglet',
  'Copy link address': 'Copier l’adresse du lien',
  'Open image in new tab': 'Ouvrir l’image dans un nouvel onglet',
  'Save image as…': 'Enregistrer l’image sous…',
  'Copy image': 'Copier l’image',
  'Copy image address': 'Copier l’adresse de l’image',
  'Copy page address': 'Copier l’adresse de la page',
  'Checking for Updates…': 'Recherche de mises à jour…',
  'Downloading Update…': 'Téléchargement de la mise à jour…',
  'Check for Updates…': 'Rechercher des mises à jour…',
  'Check for Updates on GitHub…': 'Rechercher des mises à jour sur GitHub…',
  'Background Agents': 'Agents en arrière-plan',
  'Chat History': 'Historique des discussions',
  'Live Notes': 'Notes vivantes',
  'Settings…': 'Paramètres…',
  'About Baarali': 'À propos de Baarali',
  'New Chat': 'Nouvelle discussion',
  'New Presentation…': 'Nouvelle présentation…',
  'Export Note': 'Exporter la note',
  'Search…': 'Rechercher…',
  'Toggle Browser': 'Afficher/masquer le navigateur',
  'Toggle Chat Sidebar': 'Afficher/masquer le panneau de discussion',
  'Zoom In': 'Zoom avant',
  'Zoom Out': 'Zoom arrière',
  'Actual Size': 'Taille réelle',
  'Stop Recording and Generate Notes': 'Arrêter l’enregistrement et rédiger les notes',
  'Start Meeting Notes': 'Commencer les notes de réunion',
  'Stop recording and generate notes': 'Arrêter l’enregistrement et rédiger les notes',
  'Start meeting notes': 'Commencer les notes de réunion',
  'Baarali on GitHub': 'Baarali sur GitHub',
  'Report an Issue…': 'Signaler un problème…',
  'Release Notes': 'Notes de version',
  'Keyboard Shortcuts…': 'Raccourcis clavier…',
  'Open Data Folder': 'Ouvrir le dossier des données',
  'Open Baarali': 'Ouvrir Baarali',
  'Quit Baarali': 'Quitter Baarali',
  'Could not reach the Baarali server to complete sign-in': 'Impossible de joindre le serveur Baarali pour terminer la connexion',
  // Not shown: a key name typed into a page, the browser's identity.
  Enter: 'Enter',
};

/** The French the main process uses: the screens' dictionary, the menu's words on top. */
export const FR_MAIN: Dictionary = {
  exact: { ...FR.exact, ...MENU },
  templates: {
    ...FR.templates,
    'Restart to Update$1': 'Redémarrer pour mettre à jour$1',
    'Your notes for "$1" are ready.': 'Vos notes pour « $1 » sont prêtes.',
    '$1 on $2': '$1 on $2',
    'Mozilla/5.0 ($1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$2.0.0.0 Safari/537.36': 'Mozilla/5.0 ($1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$2.0.0.0 Safari/537.36',
  },
};

// Electron's own types are not a dependency here (like src/cloud-link.ts):
// the shapes this file reads, no more.
interface MenuItemConstructorOptions {
  label?: string;
  role?: string;
  submenu?: MenuItemConstructorOptions[] | unknown;
  [key: string]: unknown;
}
type Options = Record<string, unknown>;
type Fn = (...args: unknown[]) => unknown;
interface Electron {
  app: { getLocale(): string };
  Menu: { buildFromTemplate: Fn };
  dialog: Record<'showMessageBox' | 'showMessageBoxSync' | 'showOpenDialog' | 'showSaveDialog' | 'showErrorBox', Fn>;
  Notification: { prototype: object };
}

/** Menu items Electron names itself from their role, in English. */
const ROLES: Record<string, string> = {
  undo: 'Annuler',
  redo: 'Rétablir',
  cut: 'Couper',
  copy: 'Copier',
  paste: 'Coller',
  pasteAndMatchStyle: 'Coller et adapter le style',
  delete: 'Supprimer',
  selectAll: 'Tout sélectionner',
  reload: 'Recharger',
  forceReload: 'Forcer le rechargement',
  toggleDevTools: 'Outils de développement',
  resetZoom: 'Taille réelle',
  zoomIn: 'Zoom avant',
  zoomOut: 'Zoom arrière',
  togglefullscreen: 'Plein écran',
  minimize: 'Réduire',
  close: 'Fermer la fenêtre',
  quit: 'Quitter Baarali',
  hide: 'Masquer Baarali',
  hideOthers: 'Masquer les autres',
  unhide: 'Tout afficher',
  services: 'Services',
  windowMenu: 'Fenêtre',
  help: 'Aide',
  front: 'Tout ramener au premier plan',
  zoom: 'Réduire/agrandir',
};

const fr = (text: string | undefined): string | undefined => (text ? translate(FR_MAIN, text, 'attr') ?? text : text);

export function translateMenu(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.map((item) => {
    const out = { ...item };
    if (out.label) out.label = fr(out.label);
    else if (out.role && ROLES[out.role]) out.label = ROLES[out.role];
    if (Array.isArray(out.submenu)) out.submenu = translateMenu(out.submenu);
    return out;
  });
}

function translateBox(options: Options): Options {
  const out: Options = { ...options };
  for (const key of ['title', 'message', 'detail', 'buttonLabel', 'nameFieldLabel', 'checkboxLabel']) {
    if (typeof out[key] === 'string') out[key] = fr(out[key] as string);
  }
  if (Array.isArray(out.buttons)) out.buttons = (out.buttons as string[]).map((b) => fr(b) ?? b);
  if (Array.isArray(out.filters)) out.filters = (out.filters as Array<{ name: string }>).map((f) => ({ ...f, name: fr(f.name) ?? f.name }));
  return out;
}

/** Wraps the Electron calls that show text; nothing changes in English. */
export function installMainTranslation(electron: Electron): void {
  const { app, Menu, dialog } = electron;
  const french = () => {
    try {
      return pickLang(null, app.getLocale()) === 'fr';
    } catch {
      return false;
    }
  };
  // Each wrap on its own: one that fails leaves only its own text English.
  const guard = (what: string, install: () => void) => {
    try {
      install();
    } catch (err) {
      console.error(`[i18n] ${what} stays English`, err);
    }
  };

  guard('the menus', () => {
    const build = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = (template) => build(french() ? translateMenu(template as MenuItemConstructorOptions[]) : template);
  });

  guard('the dialogs', () => {
    // A dialog's options come either first or after its window.
    const wrap = (original: Fn): Fn => (...args) => {
      if (french()) {
        const at = args.length > 1 && args[0] && typeof args[0] === 'object' && 'webContents' in (args[0] as object) ? 1 : 0;
        if (args[at] && typeof args[at] === 'object') args[at] = translateBox(args[at] as Options);
      }
      return original(...args);
    };
    for (const name of ['showMessageBox', 'showMessageBoxSync', 'showOpenDialog', 'showSaveDialog'] as const) {
      dialog[name] = wrap(dialog[name].bind(dialog));
    }
    const errorBox = dialog.showErrorBox.bind(dialog);
    dialog.showErrorBox = (title, content) =>
      french() ? errorBox(fr(title as string), fr(content as string)) : errorBox(title, content);
  });

  guard('the notifications', () => {
    // Title and body stay settable until shown: translated just before.
    const proto = electron.Notification.prototype as { show: () => void; title: string; body: string };
    const show = proto.show;
    proto.show = function (this: { title: string; body: string }) {
      if (french()) {
        this.title = fr(this.title) ?? this.title;
        this.body = fr(this.body) ?? this.body;
      }
      return show.call(this);
    };
  });
}
