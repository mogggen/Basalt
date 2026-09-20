const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("basaltDesktop", {
  onNewNote: (fn) => ipcRenderer.on("new-note", () => fn()),
  onImport: (fn) => ipcRenderer.on("import", () => fn()),
  onExport: (fn) => ipcRenderer.on("export", () => fn()),
  onShare: (fn) => ipcRenderer.on("share", () => fn()),
});
