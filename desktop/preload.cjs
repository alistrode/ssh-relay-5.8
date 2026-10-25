"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("relay", {
  call: (role, route, body) => ipcRenderer.invoke("relay", role, route, body),
  onVisible: (callback) => ipcRenderer.on("relay-visible", () => callback()),
  batch: (role, action, ids) => ipcRenderer.invoke("relay-batch", role, action, ids),
  onNotice: (callback) => ipcRenderer.on("relay-notice", (_event, text) => callback(text)),
  onAdmission: (callback) => ipcRenderer.on("relay-admission", (_event, value) => callback(value)),
  startup: () => ipcRenderer.invoke("startup-status"),
  setStartup: (value) => ipcRenderer.invoke("startup-set", value),
  copyCode: (code) => ipcRenderer.invoke("pair-copy", code),
  exportLogs: () => ipcRenderer.invoke("logs-export"),
});
