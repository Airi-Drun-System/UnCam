"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("uc", {
  version: process.argv.find((a) => a.startsWith("--uc-v="))?.slice(7) || "",
  adb: (args) => ipcRenderer.invoke("adb", args),
  cams: (serial) => ipcRenderer.invoke("cams", serial),
  start: (args) => ipcRenderer.invoke("start", args),
  stop: () => ipcRenderer.invoke("stop"),
  onLog: (cb) => ipcRenderer.on("log", (_e, l) => cb(l)),
  onExit: (cb) => ipcRenderer.on("exit", (_e, c) => cb(c)),
  onUpdate: (cb) => ipcRenderer.on("upd", (_e, o) => cb(o)),
  restart: () => ipcRenderer.send("upd-restart"),
  win: (a) => ipcRenderer.send("win", a),
  open: (u) => ipcRenderer.send("open", u)
});
