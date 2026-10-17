"use strict";
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var crypto = require("node:crypto");
var { utils } = require("ssh2");
var S = utils.sftp.STATUS_CODE;
function serveSftp(stream) {
  const handles = /* @__PURE__ */ new Map();
  function local(p) {
    if (p.includes("\0")) throw new Error("Invalid path");
    if (process.platform === "win32" && /^\/[a-z]:\//i.test(p)) p = p.slice(1);
    return path.resolve(os.homedir(), p || ".");
  }
  function fail(id, e) {
    stream.status(id, e && e.code === "ENOENT" ? S.NO_SUCH_FILE : e && ["EACCES", "EPERM"].includes(e.code) ? S.PERMISSION_DENIED : S.FAILURE);
  }
  function handle(type, value) {
    const key = crypto.randomBytes(16);
    handles.set(key.toString("hex"), { type, ...value });
    return key;
  }
  function lookup(id, key, type) {
    const value = handles.get(key.toString("hex"));
    if (!value || type && value.type !== type) {
      stream.status(id, S.FAILURE);
      return null;
    }
    return value;
  }
  stream.on("OPEN", (id, p, flags, attrs) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    const c = fs.constants;
    let mode = flags & 2 ? flags & 1 ? c.O_RDWR : c.O_WRONLY : c.O_RDONLY;
    if (flags & 4) mode |= c.O_APPEND;
    if (flags & 8) mode |= c.O_CREAT;
    if (flags & 16) mode |= c.O_TRUNC;
    if (flags & 32) mode |= c.O_EXCL;
    fs.open(
      target,
      mode,
      attrs.mode === void 0 ? 384 : attrs.mode,
      (e, fd) => e ? fail(id, e) : stream.handle(id, handle("file", { fd }))
    );
  });
  stream.on("READ", (id, key, offset, length) => {
    const h = lookup(id, key, "file");
    if (!h) return;
    if (!Number.isSafeInteger(offset) || offset < 0 || length > 262144) return stream.status(id, S.FAILURE);
    const b = Buffer.alloc(length);
    fs.read(h.fd, b, 0, length, offset, (e, n) => {
      if (e) fail(id, e);
      else if (!n) stream.status(id, S.EOF);
      else stream.data(id, b.subarray(0, n));
    });
  });
  stream.on("WRITE", (id, key, offset, data2) => {
    const h = lookup(id, key, "file");
    if (!h) return;
    if (!Number.isSafeInteger(offset) || offset < 0 || data2.length > 262144) return stream.status(id, S.FAILURE);
    function write(at) {
      fs.write(h.fd, data2, at, data2.length - at, offset + at, (e, n) => {
        if (e) return fail(id, e);
        if (!n) return stream.status(id, S.FAILURE);
        if (at + n < data2.length) write(at + n);
        else stream.status(id, S.OK);
      });
    }
    if (!data2.length) stream.status(id, S.OK);
    else write(0);
  });
  stream.on("CLOSE", (id, key) => {
    const h = lookup(id, key);
    if (!h) return;
    handles.delete(key.toString("hex"));
    if (h.type === "file") fs.close(h.fd, (e) => e ? fail(id, e) : stream.status(id, S.OK));
    else stream.status(id, S.OK);
  });
  for (const name of ["STAT", "LSTAT"]) stream.on(name, (id, p) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    fs[name === "STAT" ? "stat" : "lstat"](target, (e, attrs) => e ? fail(id, e) : stream.attrs(id, attrs));
  });
  stream.on("FSTAT", (id, key) => {
    const h = lookup(id, key, "file");
    if (!h) return;
    fs.fstat(h.fd, (e, attrs) => e ? fail(id, e) : stream.attrs(id, attrs));
  });
  stream.on("REALPATH", (id, p) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    fs.realpath(target, (e, value) => {
      if (e) return fail(id, e);
      let filename = value.replace(/\\/g, "/");
      if (process.platform === "win32" && /^[a-z]:\//i.test(filename)) filename = "/" + filename;
      stream.name(id, [{ filename, longname: filename, attrs: {} }]);
    });
  });
  stream.on("OPENDIR", (id, p) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    fs.readdir(target, (e, names) => e ? fail(id, e) : stream.handle(id, handle("dir", { path: target, names, offset: 0 })));
  });
  stream.on("READDIR", (id, key) => {
    const h = lookup(id, key, "dir");
    if (!h) return;
    const names = h.names.slice(h.offset, h.offset + 32);
    h.offset += names.length;
    if (!names.length) return stream.status(id, S.EOF);
    Promise.all(names.map(async (filename) => {
      try {
        const attrs = await fs.promises.lstat(path.join(h.path, filename));
        return { filename, longname: filename, attrs };
      } catch {
        return null;
      }
    })).then((entries) => {
      const valid = entries.filter(Boolean);
      if (valid.length) stream.name(id, valid);
      else stream.status(id, S.EOF);
    }).catch((e) => fail(id, e));
  });
  for (const [name, method] of [["REMOVE", "unlink"], ["RMDIR", "rmdir"]]) stream.on(name, (id, p) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    fs[method](target, (e) => e ? fail(id, e) : stream.status(id, S.OK));
  });
  stream.on("MKDIR", (id, p, attrs) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    fs.mkdir(target, { mode: attrs.mode === void 0 ? 448 : attrs.mode }, (e) => e ? fail(id, e) : stream.status(id, S.OK));
  });
  stream.on("RENAME", (id, from, to) => {
    try {
      from = local(from);
      to = local(to);
    } catch (e) {
      return fail(id, e);
    }
    fs.rename(from, to, (e) => e ? fail(id, e) : stream.status(id, S.OK));
  });
  async function setAttrs(id, target, attrs, fd) {
    try {
      for (const k of Object.keys(attrs)) if (attrs[k] !== void 0 && !["size", "uid", "gid", "mode", "atime", "mtime", "flags"].includes(k)) throw new Error("Unsupported attributes");
      const call = (method, ...args) => new Promise((resolve, reject) => fs[method](target, ...args, (e) => e ? reject(e) : resolve()));
      if (attrs.size !== void 0) await call(fd ? "ftruncate" : "truncate", attrs.size);
      if (attrs.mode !== void 0) await call(fd ? "fchmod" : "chmod", attrs.mode);
      if (attrs.uid !== void 0 && attrs.gid !== void 0) await call(fd ? "fchown" : "chown", attrs.uid, attrs.gid);
      if (attrs.atime !== void 0 && attrs.mtime !== void 0) await call(fd ? "futimes" : "utimes", attrs.atime, attrs.mtime);
      stream.status(id, S.OK);
    } catch (e) {
      fail(id, e);
    }
  }
  stream.on("SETSTAT", (id, p, attrs) => {
    try {
      setAttrs(id, local(p), attrs, false);
    } catch (e) {
      fail(id, e);
    }
  });
  stream.on("FSETSTAT", (id, key, attrs) => {
    const h = lookup(id, key, "file");
    if (h) setAttrs(id, h.fd, attrs, true);
  });
  stream.on("READLINK", (id, p) => {
    let target;
    try {
      target = local(p);
    } catch (e) {
      return fail(id, e);
    }
    fs.readlink(target, (e, value) => e ? fail(id, e) : stream.name(id, [{ filename: value, longname: value, attrs: {} }]));
  });
  stream.on("SYMLINK", (id, target, link) => {
    try {
      target = local(target);
      link = local(link);
    } catch (e) {
      return fail(id, e);
    }
    fs.symlink(target, link, (e) => e ? fail(id, e) : stream.status(id, S.OK));
  });
  stream.on("EXTENDED", (id) => stream.status(id, S.OP_UNSUPPORTED));
  stream.on("end", () => stream.end());
  stream.on("error", () => {
  });
  stream.on("close", () => {
    for (const h of handles.values()) if (h.type === "file") fs.close(h.fd, () => {
    });
    handles.clear();
  });
}
module.exports = { serveSftp };
