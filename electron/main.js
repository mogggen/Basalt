const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");
const { startServer } = require("../server");

// Unpackaged Linux builds often lack a setuid chrome-sandbox.
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");

let mainWindow = null;

function send(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Note", accelerator: "CmdOrCtrl+N", click: () => send("new-note") },
        { label: "Import…", click: () => send("import") },
        { label: "Export ZIP", click: () => send("export") },
        { type: "separator" },
        { label: "Share via Wormhole", click: () => send("share") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Wormhole.app",
          click: () => shell.openExternal("https://wormhole.app"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const { url } = await startServer({ host: "127.0.0.1", port: 0 });
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "Basalt",
    backgroundColor: "#1b1b1f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  await mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  buildMenu();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
