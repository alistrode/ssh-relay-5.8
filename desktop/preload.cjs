"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("relay", {
  call: (role, route, body) => ipcRenderer.invoke("relay", role, route, body),
  onVisible: (callback) => ipcRenderer.on("relay-visible", () => callback()),
  startup: () => ipcRenderer.invoke("startup-status"),
  setStartup: (value) => ipcRenderer.invoke("startup-set", value),
  copyCode: (code) => ipcRenderer.invoke("pair-copy", code),
  exportLogs: () => ipcRenderer.invoke("logs-export"),
});
