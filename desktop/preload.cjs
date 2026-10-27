"use strict";
function diagnosticStack(error,seen=new Set()){if(error==null)return "";if(typeof error!=="object")return String(error);if(seen.has(error))return "[Circular error cause]";seen.add(error);let stack=String(error.stack||error.message||error);if(error.cause!==undefined)stack+="\nCaused by: "+diagnosticStack(error.cause,seen);if(Array.isArray(error.errors))for(const nested of error.errors)stack+="\nAggregate error: "+diagnosticStack(nested,seen);return stack;}
const { contextBridge, ipcRenderer } = require("electron");
window.addEventListener("error",event=>ipcRenderer.send("renderer-diagnostic",{event:event.error?"renderer_error":"renderer_resource_error",message:String(event.error?.message||event.message||"Resource failed to load"),stack:diagnosticStack(event.error),line:event.lineno,column:event.colno}),true);
window.addEventListener("unhandledrejection",event=>ipcRenderer.send("renderer-diagnostic",{event:"renderer_rejection",message:String(event.reason?.message||event.reason),stack:diagnosticStack(event.reason)}));
contextBridge.exposeInMainWorld("relay", {
  diagnostic: value => { if(value&&["renderer_error","renderer_rejection","renderer_resource_error"].includes(value.event))ipcRenderer.send("renderer-diagnostic",{event:value.event,message:String(value.message||""),stack:String(value.stack||""),line:Number(value.line)||0,column:Number(value.column)||0}); },
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
