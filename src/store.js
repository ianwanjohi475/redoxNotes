// Storage layer. In the desktop app every document is a JSON file on disk
// (Documents\RedoxNotes\notes). When opened in a plain browser (for
// development) it falls back to localStorage.

const T = window.__TAURI__;
export const isApp = !!(T && T.core && T.core.invoke);
const invoke = isApp ? T.core.invoke : null;

const LS_DOCS = 'redox.docs.v1';
const LS_SETTINGS = 'redox.settings.v1';
let mem = null;

function lsRead(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('storage failed', e); }
}

export function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export const Store = {
  async loadAll() {
    if (isApp) return await invoke('load_all');
    mem = lsRead(LS_DOCS, {});
    return Object.values(mem);
  },
  async save(doc) {
    if (isApp) return invoke('save_doc', { id: doc.id, json: JSON.stringify(doc) });
    mem = mem || lsRead(LS_DOCS, {});
    mem[doc.id] = doc;
    lsWrite(LS_DOCS, mem);
  },
  async remove(id) {
    if (isApp) return invoke('delete_doc', { id });
    mem = mem || lsRead(LS_DOCS, {});
    delete mem[id];
    lsWrite(LS_DOCS, mem);
  },
  async loadSettings() {
    if (isApp) {
      const s = await invoke('load_settings');
      try { return s ? JSON.parse(s) : null; } catch { return null; }
    }
    return lsRead(LS_SETTINGS, null);
  },
  async saveSettings(s) {
    if (isApp) return invoke('save_settings', { json: JSON.stringify(s, null, 2) });
    lsWrite(LS_SETTINGS, s);
  },
  async dataLocation() {
    return isApp ? invoke('data_location') : 'Browser storage (development mode)';
  },
  async openDataFolder() {
    if (isApp) return invoke('open_data_folder');
  },
  async openPath(path) {
    if (isApp) return invoke('open_path', { path });
  },
  /** Save bytes through a native "Save as" dialog. Returns the path or null. */
  async exportFile(defaultName, filterName, ext, bytes) {
    if (isApp) {
      return await invoke('export_file', { defaultName, filterName, ext, b64: bytesToB64(bytes) });
    }
    const blob = new Blob([bytes]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return defaultName;
  },
};

/** Hook the window close so pending edits are flushed to disk first. */
export function onAppClose(flush) {
  window.addEventListener('beforeunload', () => { flush(); });
  if (!isApp) return;
  try {
    const win = T.window.getCurrentWindow();
    win.onCloseRequested(async (event) => {
      event.preventDefault();
      try { await flush(); } finally { await win.destroy(); }
    });
  } catch (e) { console.warn('close hook unavailable', e); }
}

export function setWindowTitle(title) {
  document.title = title;
  if (!isApp) return;
  try { T.window.getCurrentWindow().setTitle(title); } catch { /* ignore */ }
}
