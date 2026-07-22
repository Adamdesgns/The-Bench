// main.js — Electron desktop wrapper for THE BENCH.
//
// Starts the bundled backend (server/index.js) in-process, then opens the Bench
// OS UI in its own window. No browser, no command line — a real Windows app.
// Model keys are saved locally by the app (Settings); nothing is committed.

import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || "8137";
process.env.PORT = PORT;

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api/health`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: "#111111",
    title: "The Bench",
    autoHideMenuBar: true, // the app has its own in-window menu bar
    webPreferences: { contextIsolation: true }
  });
  win.loadURL(`http://localhost:${PORT}/`);
  // external links open in the real browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

app.whenReady().then(async () => {
  // Boot the backend (side effect: server.listen on PORT).
  await import(pathToFileURL(resolve(__dirname, "../server/index.js")).href);
  await waitForServer();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
