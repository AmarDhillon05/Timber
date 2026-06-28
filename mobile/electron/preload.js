// Minimal, safe bridge. Exposes a flag so app code *can* tell it's running
// inside the Electron desktop shell (vs a plain browser) — useful e.g. to skip
// the "tick Share system audio" hint, since Electron auto-grants loopback.
// Nothing privileged is exposed.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform, // 'win32' | 'darwin' | 'linux'
});
