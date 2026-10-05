import { app, BrowserWindow, shell } from "electron";
import { startXecutor } from "../server/xecutor.js";

app.setName("The Xecutor");
let gateway = null;
let ownerWindow = null;

function createWindow(port) {
  ownerWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 390,
    minHeight: 700,
    backgroundColor: "#030403",
    title: "The Xecutor",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ownerWindow.loadURL(`http://127.0.0.1:${port}/`);
  ownerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  ownerWindow.on("closed", () => { ownerWindow = null; });
}

app.whenReady().then(async () => {
  gateway = await startXecutor();
  createWindow(gateway.port);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(gateway.port); });
}).catch((error) => {
  process.stderr.write(`The Xecutor refused to open: ${error.message}\n`);
  app.quit();
});

app.on("before-quit", () => { gateway?.close().catch(() => undefined); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
