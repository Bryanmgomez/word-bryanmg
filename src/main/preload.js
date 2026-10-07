const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('papiroDesktop', {
  isDesktop: true,
  saveFile: (name, dataBase64, ext) => ipcRenderer.invoke('file:save', name, dataBase64, ext),
  openFile: (exts) => ipcRenderer.invoke('file:open', exts),
  readText: (filePath) => ipcRenderer.invoke('file:read', filePath),
  appInfo: () => ipcRenderer.invoke('app:info'),
  print: () => ipcRenderer.invoke('app:print')
});
