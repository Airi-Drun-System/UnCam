"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, v) => cb(v));
contextBridge.exposeInMainWorld("uc", {
  version: process.argv.find((a) => a.startsWith("--uc-v="))?.slice(7) || "",
  adb: (args) => ipcRenderer.invoke("adb", args),
  cams: (serial) => ipcRenderer.invoke("cams", serial),
  start: (o) => ipcRenderer.invoke("start", o),
  stop: () => ipcRenderer.invoke("stop"),
  ctl: (m) => ipcRenderer.send("ctl", m),
  view: (v) => ipcRenderer.send("view", v),
  vcamState: () => ipcRenderer.invoke("vcamState"),
  vcamInstall: () => ipcRenderer.invoke("vcamInstall"),
  onLog: on("log"),
  onExit: on("exit"),
  onV: on("v"),
  onRate: on("rate"),
  onView: on("view"),
  onUpdate: on("upd"),
  restart: () => ipcRenderer.send("upd-restart"),
  win: (a) => ipcRenderer.send("win", a)
});
