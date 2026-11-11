"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { execFile, spawn } = require("child_process");
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.vegasdev.uncam");
const BIN = app.isPackaged ? path.join(process.resourcesPath, "scrcpy") : path.join(__dirname, "scrcpy");
const exe = (n) => path.join(BIN, process.platform === "win32" ? n + ".exe" : n);
const env = { ...process.env, ADB: exe("adb"), SCRCPY_SERVER_PATH: path.join(BIN, "scrcpy-server") };
let win = null, cam = null;
function run(file, args, timeout = 15000) {
  return new Promise((res) => {
    execFile(file, args, { env, timeout, windowsHide: true }, (err, out, errOut) => res({ ok: !err, out: String(out) + String(errOut), missing: !!(err && err.code === "ENOENT") }));
  });
}
const ADB_OK = new Set(["devices", "connect", "disconnect", "pair", "tcpip", "shell", "mdns", "kill-server", "start-server"]);
ipcMain.handle("adb", (_e, args) => {
  const cmd = args[0] === "-s" ? args[2] : args[0];
  if (!Array.isArray(args) || !ADB_OK.has(cmd) || !args.every((a) => typeof a === "string")) return { ok: false, out: "bad command" };
  if (cmd === "shell" && args.slice(3).join(" ") !== "ip -f inet addr show wlan0") return { ok: false, out: "bad command" };
  return run(exe("adb"), args);
});
ipcMain.handle("cams", (_e, serial) => run(exe("scrcpy"), ["-s", String(serial), "--list-camera-sizes"], 30000));
ipcMain.handle("start", (_e, args) => {
  if (cam) return false;
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string" && (a.startsWith("-") || /^[\w.:\-]+$/.test(a)))) return false;
  cam = spawn(exe("scrcpy"), args, { env, windowsHide: true });
  const send = (ch, v) => win && !win.isDestroyed() && win.webContents.send(ch, v);
  const feed = (d) => String(d).split(/\r?\n/).forEach((l) => l.trim() && send("log", l));
  cam.stdout.on("data", feed);
  cam.stderr.on("data", feed);
  cam.on("error", (e) => send("log", "ERROR: " + e.message));
  cam.on("close", (code) => { cam = null; send("exit", code); });
  return true;
});
ipcMain.handle("stop", () => { if (cam) cam.kill(); return true; });
ipcMain.on("win", (_e, a) => {
  if (!win) return;
  if (a === "min") win.minimize();
  else if (a === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (a === "close") win.close();
});
ipcMain.on("open", (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
function updates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoInstallOnAppQuit = true;
    const tell = (o) => win && win.webContents.send("upd", o);
    autoUpdater.on("update-available", (i) => tell({ s: "load", v: i.version }));
    autoUpdater.on("update-downloaded", (i) => tell({ s: "ready", v: i.version }));
    ipcMain.on("upd-restart", () => autoUpdater.quitAndInstall());
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  } catch {}
}
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#0a0a0a",
    title: "UnCam",
    icon: path.join(__dirname, "build", "icon.png"),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js"), additionalArguments: ["--uc-v=" + app.getVersion()], spellcheck: false }
  });
  win.loadFile(path.join(__dirname, "src", "index.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  updates();
});
app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
app.on("window-all-closed", () => {
  if (cam) cam.kill();
  app.quit();
});
