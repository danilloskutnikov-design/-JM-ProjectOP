const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
});
