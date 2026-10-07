const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const registerFileIpc = require('./ipc');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
]);

function resolveRendererPath(url) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(url).pathname || '/');
  } catch { /* usar raíz */ }
  if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';
  const normalized = path.normalize(pathname).replace(/^([/\\])+/, '');
  const filePath = path.join(RENDERER_DIR, normalized);
  if (!filePath.startsWith(RENDERER_DIR)) return null;
  return filePath;
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 360,
    minHeight: 500,
    backgroundColor: '#f3f4f8',
    title: 'Word BryanMG',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  const startUrl = process.env.PAPIRO_URL || 'app://bundle/index.html';
  win.loadURL(startUrl);

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !url.startsWith(process.env.PAPIRO_URL || 'app://')) {
      e.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const filePath = resolveRendererPath(request.url);
    if (!filePath) return new Response('403', { status: 403 });
    try {
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
      });
    } catch {
      return new Response('404', { status: 404 });
    }
  });

  Menu.setApplicationMenu(null);
  registerFileIpc(ipcMain, () => win, dialog, app);

  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    desktop: true
  }));

  ipcMain.handle('app:print', async () => {
    if (!win) return { ok: false };
    return new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (ok, err) => {
        resolve({ ok: !!ok, error: err ? String(err) : null });
      });
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
