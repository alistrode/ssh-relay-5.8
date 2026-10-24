"use strict";
const path = require("node:path");
const { execFile } = require("node:child_process");

// Windows can stamp extracted application images with a Low mandatory label.
// Chromium's image-load mitigation then refuses its own sandboxed children.
// Restore normal image labels once at GUI startup; leave DACLs, owners, private
// state, process privileges and Chromium's sandbox policies unchanged.
async function prepareRuntimeImages(record = () => {}) {
  if (process.platform !== "win32") return;
  const icacls = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe");
  for (const image of [process.execPath, path.join(path.dirname(process.execPath), "*.dll")]) {
    await new Promise(resolve => {
      execFile(icacls, [image, "/setintegritylevel", "M", "/Q"],
        { windowsHide: true, timeout: 10000 }, error => {
          // Read-only installations may already have normal labels. Do not
          // prevent startup or request elevation when metadata cannot be set.
          record("runtime_image_label", { exitCode: error ? (Number.isInteger(error.code) ? error.code : -1) : 0 });
          resolve();
        });
    });
  }
}
module.exports = { prepareRuntimeImages };
