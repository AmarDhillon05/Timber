// Electron main process — a thin desktop shell around the SAME web build the
// browser uses (react-native-web). It adds one Windows superpower: it answers
// getDisplayMedia with the screen + *loopback* (system) audio automatically, so
// the renderer's system-audio handler gets system audio with NO picker dialog.
//
// Two ways to load the app:
//   • dev  — set ELECTRON_START_URL to the Expo web dev server (hot reload).
//   • prod — no env var: serve the static export in ../dist.
//
// IMPORTANT: the Expo web export references its bundle with ABSOLUTE paths
// (e.g. /_expo/static/...). Loading dist/index.html over file:// would resolve
// those against the filesystem root and the app would render nothing (a blank
// window). So in prod we serve dist over a custom `app://` scheme where the
// origin root maps to the dist folder, and absolute paths resolve correctly.
//
// Nothing here is app logic; all capture logic stays in src/ behind the
// src/audio/systemAudio factory, so iOS/web/electron share it untouched.

const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  protocol,
  net,
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const DEV_URL = process.env.ELECTRON_START_URL; // e.g. http://localhost:8081
const DIST = path.join(__dirname, '..', 'dist');

// Under WSL/WSLg the GPU process fails to initialize (the viz_main_impl /
// GpuControl errors), which can also wedge rendering. Software-render on Linux;
// on real Windows hardware acceleration stays on.
if (process.platform === 'linux') app.disableHardwareAcceleration();

// Must be registered before the app is ready. `standard` gives the scheme a
// real origin so absolute (`/_expo/...`) URLs resolve against the dist root.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveDist() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(DIST, decodeURIComponent(rel));
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f172a', // match the app so there's no white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // Open DevTools so the Console is always available, and shout if the page
  // fails to load instead of silently showing a blank window.
  win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[electron] did-fail-load ${code} ${desc} — ${url}`);
  });

  // Allow camera + mic (getUserMedia) and screen capture. Without this Electron
  // can silently deny these, so the camera preview stays black and the mic
  // records nothing. (The OS-level Windows privacy toggles still apply.)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission));
  });

  // Auto-grant screen + system-audio capture. `audio: 'loopback'` is the
  // Electron-on-Windows feature that captures the OS output mix directly, so the
  // renderer never sees the "share your screen" prompt — getDisplayMedia just
  // resolves with a system-audio track. We hand back the primary screen as the
  // (required) video source; the renderer drops it and keeps only the audio.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    serveDist();
    win.loadURL('app://local/index.html');
  }
}

app.whenReady().then(() => {
  createWindow();
  // macOS: re-open a window when the dock icon is clicked with none open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows close, except on macOS where apps stay alive.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
