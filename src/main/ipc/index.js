const files = require('../services/files');

function register(ipcMain, getWin, dialog, app) {
  ipcMain.handle('file:save', async (event, name, dataBase64, ext) => {
    const win = getWin();
    const defaultPath = files.suggestPath(app, name, ext);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Guardar documento',
      defaultPath,
      filters: files.filtersFor(ext)
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      files.writeBase64(filePath, dataBase64);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('file:open', async (event, exts) => {
    const win = getWin();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Abrir documento',
      properties: ['openFile'],
      filters: files.filtersForList(exts)
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = files.read(filePaths[0]);
      return { ok: true, filePath: filePaths[0], name: files.baseName(filePaths[0]), dataBase64: Buffer.from(raw).toString('base64') };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('file:read', (event, filePath) => {
    try {
      const raw = files.read(filePath);
      return { ok: true, dataBase64: Buffer.from(raw).toString('base64') };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}

module.exports = register;
