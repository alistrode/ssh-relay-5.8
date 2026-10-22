"use strict";
// Preserve Chromium sandboxing. Prepare only this application's bundled helper
// when the OS does not permit an unprivileged user namespace.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const sandboxSHA256 = "a4f6dfd7325ddd55f94ddc0c487d22726d40ef099ded6475d5dffe236e277896";
function launch(root, args = []) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let flags = [];
  if (process.platform === "linux") {
    const helper = path.join(root, "chrome-sandbox");
    const validHelper = () => {
      const st = fs.lstatSync(helper);
      return st.isFile() && !st.isSymbolicLink() && st.uid === 0 && (st.mode & 0o7777) === 0o4755 &&
        require("node:crypto").createHash("sha256").update(fs.readFileSync(helper)).digest("hex") === sandboxSHA256;
    };
    if (!validHelper()) {
      const namespace = cp.spawnSync("unshare", ["--user", "--map-root-user", "true"], { stdio: "ignore" });
      if (namespace.status === 0) flags = ["--disable-setuid-sandbox"];
      else {
        console.log("本系统限制普通用户创建沙箱。需要一次 sudo 授权，仅准备本文件夹内官方 chrome-sandbox 的权限；不修改系统安全设置。");
        // Copy to a fresh root-owned descriptor, verify that copy against the
        // pinned official Electron hash, then atomically replace the helper.
        const install = `import os,sys,stat,tempfile,hashlib
p=sys.argv[1]; expected=sys.argv[2]
fd,tmp=tempfile.mkstemp(prefix='.chrome-sandbox-',dir=os.path.dirname(p))
try:
 with open(p,'rb') as source, os.fdopen(os.dup(fd),'wb') as target:
  while True:
   chunk=source.read(1048576)
   if not chunk: break
   target.write(chunk)
 os.lseek(fd,0,0); h=hashlib.sha256()
 while True:
  chunk=os.read(fd,1048576)
  if not chunk: break
  h.update(chunk)
 if h.hexdigest()!=expected: raise RuntimeError('Official sandbox hash mismatch')
 os.fchown(fd,0,0); os.fchmod(fd,0o4755); os.fsync(fd)
 os.replace(tmp,p)
finally:
 os.close(fd)
 if os.path.lexists(tmp): os.unlink(tmp)
`;
        const result = cp.spawnSync("sudo", ["--", "/usr/bin/python3", "-c", install, helper, sandboxSHA256], { stdio: "inherit" });
        if (result.status !== 0 || !validHelper()) throw Error("本程序沙箱准备未完成；未关闭沙箱。CLI/MCP 后台仍可使用。");
      }
    }
  }
  const executable = path.join(root, process.platform === "win32" ? "SSHRelayPro.exe" : "ssh-relay-pro");
  const child = cp.spawn(executable, [...flags, "--no-shortcuts", ...args], { detached: true, stdio: "ignore", env });
  child.on("error", error => { console.error("图形界面启动失败：" + error.message); process.exitCode = 1; });
  child.unref();
  return child;
}
module.exports = { launch };
if (require.main === module) {
  try { launch(path.resolve(__dirname, "../../.."), process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
