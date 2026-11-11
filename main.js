"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { execFile, spawn } = require("child_process");
const net = require("net");
const { StreamParser, serverArgs } = require("./proto.js");
if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === "win32") app.setAppUserModelId("com.vegasdev.uncam");
const BIN = app.isPackaged ? path.join(process.resourcesPath, "scrcpy") : path.join(__dirname, "scrcpy");
const exe = (n) => path.join(BIN, process.platform === "win32" ? n + ".exe" : n);
const env = { ...process.env, ADB: exe("adb"), SCRCPY_SERVER_PATH: path.join(BIN, "scrcpy-server") };
let win = null;
function run(file, args, timeout = 15000) {
  return new Promise((res) => {
    execFile(file, args, { env, timeout, windowsHide: true }, (err, out, errOut) => res({ ok: !err, out: String(out) + String(errOut), missing: !!(err && err.code === "ENOENT") }));
  });
}
const ADB_OK = new Set(["devices", "connect", "disconnect", "pair", "tcpip", "shell", "mdns"]);
ipcMain.handle("adb", (_e, args) => {
  const cmd = args[0] === "-s" ? args[2] : args[0];
  if (!Array.isArray(args) || !ADB_OK.has(cmd) || !args.every((a) => typeof a === "string")) return { ok: false, out: "bad command" };
  if (cmd === "shell" && args.slice(3).join(" ") !== "ip -f inet addr show wlan0") return { ok: false, out: "bad command" };
  return run(exe("adb"), args);
});
ipcMain.handle("cams", (_e, serial) => run(exe("scrcpy"), ["-s", String(serial), "--list-camera-sizes"], 30000));
const SERVER_VER = "5.0.1", REMOTE = "/data/local/tmp/uncam-server.jar";
let sess = null, obs = null, lastSize = null, lastCodec = null;
const send = (ch, v) => { for (const w of [win, obs]) if (w && !w.isDestroyed()) w.webContents.send(ch, v); };
const say = (l) => win && !win.isDestroyed() && win.webContents.send("log", l);
function connectTcp(port, tries) {
  return new Promise((res, rej) => {
    const s = net.connect(port, "127.0.0.1");
    let got = false;
    s.once("data", (d) => { got = true; s.pause(); s.unshift(d); res(s); });
    s.once("error", () => {});
    s.once("close", () => {
      if (got) return;
      if (tries <= 0 || !sess) return rej(new Error("Телефон не ответил"));
      setTimeout(() => connectTcp(port, tries - 1).then(res, rej), 150);
    });
  });
}
async function stopStream() {
  const s = sess;
  if (!s) return;
  sess = null;
  for (const k of ["video", "control"]) if (s[k]) s[k].destroy();
  if (s.proc) s.proc.kill();
  await run(exe("adb"), ["-s", s.serial, "forward", "--remove", "tcp:" + s.port]);
  send("exit", s.code || 0);
}
ipcMain.handle("start", async (_e, o) => {
  if (sess) return false;
  const serial = String(o.serial);
  const scid = (Math.floor(Math.random() * 0x7fffffff)).toString(16).padStart(8, "0");
  const port = 27200 + Math.floor(Math.random() * 600);
  sess = { serial, port };
  const me = sess;
  say("Загружаю сервер на телефон...");
  const push = await run(exe("adb"), ["-s", serial, "push", path.join(BIN, "scrcpy-server"), REMOTE]);
  if (!push.ok) { say("ERROR: " + push.out); me.code = 1; await stopStream(); return false; }
  const fw = await run(exe("adb"), ["-s", serial, "forward", "tcp:" + port, "localabstract:scrcpy_" + scid]);
  if (!fw.ok) { say("ERROR: " + fw.out); me.code = 1; await stopStream(); return false; }
  const args = serverArgs({ ...o, scid });
  say("> server " + args.join(" "));
  me.proc = spawn(exe("adb"), ["-s", serial, "shell", "CLASSPATH=" + REMOTE, "app_process", "/", "com.genymobile.scrcpy.Server", SERVER_VER, ...args], { env, windowsHide: true });
  const feed = (d) => String(d).split(/\r?\n/).forEach((l) => l.trim() && say(l));
  me.proc.stdout.on("data", feed);
  me.proc.stderr.on("data", feed);
  me.proc.on("close", (c) => { if (sess === me) { me.code = c || 0; stopStream(); } });
  try {
    me.video = await connectTcp(port, 40);
    me.control = await new Promise((res, rej) => { const c = net.connect(port, "127.0.0.1", () => res(c)); c.once("error", rej); });
    me.control.on("data", () => {});
    me.control.on("error", () => {});
  } catch (e) {
    say("ERROR: " + e.message);
    if (sess === me) { me.code = 1; await stopStream(); }
    return false;
  }
  const parser = new StreamParser((ev) => {
    if (ev.t === "codec") lastCodec = ev;
    if (ev.t === "size") lastSize = ev;
    if (ev.t === "codec" && ev.name === "error") { say("ERROR: камера не запустилась (проверь разрешение и fps)"); }
    send("v", ev);
  });
  me.video.on("data", (d) => parser.push(d));
  me.video.on("error", () => {});
  me.video.on("close", () => { if (sess === me) stopStream(); });
  me.video.resume();
  return true;
});
ipcMain.handle("stop", () => stopStream());
ipcMain.on("ctl", (_e, m) => {
  if (!sess || !sess.control) return;
  if (m === "reset") sess.control.write(Buffer.from([17]));
  else if (m === "zin") sess.control.write(Buffer.from([19]));
  else if (m === "zout") sess.control.write(Buffer.from([20]));
  else if (m === "torch1" || m === "torch0") sess.control.write(Buffer.from([18, m === "torch1" ? 1 : 0]));
});
ipcMain.on("view", (_e, v) => send("view", v));
ipcMain.on("obs", () => {
  if (obs && !obs.isDestroyed()) return obs.focus();
  const w = lastSize ? lastSize.w : 1280, h = lastSize ? lastSize.h : 720, k = Math.min(1, 960 / Math.max(w, h));
  obs = new BrowserWindow({ width: Math.round(w * k), height: Math.round(h * k), title: "UnCam — вебка", backgroundColor: "#000000", icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") } });
  obs.loadFile(path.join(__dirname, "src", "obs.html"));
  obs.webContents.once("did-finish-load", () => {
    if (lastCodec) obs.webContents.send("v", lastCodec);
    if (lastSize) obs.webContents.send("v", lastSize);
    if (win) win.webContents.send("obsOpen");
    if (sess && sess.control) sess.control.write(Buffer.from([17]));
  });
  obs.on("closed", () => { obs = null; });
});
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
  win.on("closed", () => { win = null; app.quit(); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  updates();
});
app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (sess) { if (sess.proc) sess.proc.kill(); } });
