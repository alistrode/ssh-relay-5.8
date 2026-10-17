import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sftp, sftpCall, connect } from "./transport.js";
export async function remotePath(server, input) {
  if (typeof input !== "string" || input.includes("\0"))
    throw new Error("Invalid remote path");
  let p = input.replaceAll("\\", "/");
  const s = await sftp(server);
  if (p === "~" || p.startsWith("~/"))
    p = (await sftpCall(s, "realpath", ".")) + p.slice(1);
  return p;
}
export async function upload(a) {
  const s = await sftp(a.server);
  const target = await remotePath(a.server, a.remotePath);
  await sftpCall(s, "fastPut", path.resolve(a.localPath), target);
  const info = await sftpCall(s, "stat", target);
  if (info.size !== fs.statSync(a.localPath).size)
    throw new Error("Upload size verification failed");
  return {
    success: true,
    localPath: path.resolve(a.localPath),
    remotePath: target,
    bytes: info.size,
  };
}
export async function download(a) {
  const s = await sftp(a.server);
  const source = await remotePath(a.server, a.remotePath);
  await sftpCall(s, "fastGet", source, path.resolve(a.localPath));
  return {
    success: true,
    localPath: path.resolve(a.localPath),
    remotePath: source,
    bytes: fs.statSync(a.localPath).size,
  };
}
async function hash(stream) {
  const h = crypto.createHash("sha256");
  for await (const data of stream) h.update(data);
  return h.digest("hex");
}
function exclusions(patterns) {
  return (patterns || []).map((p) => {
    if (p.includes("\0")) throw new Error("Invalid exclusion");
    return new RegExp(
      "^" +
        p
          .split("**")
          .map((x) =>
            x
              .split("*")
              .map((y) => y.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
              .join("[^/]*"),
          )
          .join(".*") +
        "(?:/.*)?$",
    );
  });
}
export async function sync(a) {
  const timeout = a.timeout ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000)
    throw new Error("Sync timeout must be 1..300000 ms");
  const conn = await connect(a.server);
  let cancelled = false,
    timer;
  const check = () => {
    if (cancelled)
      throw new Error(
        "Synchronization cancelled; inspect destination before retrying",
      );
  };
  const work = syncInternal(a, check);
  try {
    return await Promise.race([
      work,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          cancelled = true;
          conn.close();
          reject(
            new Error(
              "Synchronization timed out; SSH connection closed. Inspect destination before retrying",
            ),
          );
        }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function syncInternal(a, check) {
  const split = (value, fallback) =>
    value.startsWith("local:")
      ? ["local", value.slice(6)]
      : value.startsWith("remote:")
        ? ["remote", value.slice(7)]
        : [fallback, value];
  const [srcType, source] = split(a.source, "local"),
    [dstType, destination] = split(a.destination, "remote");
  if (srcType === dstType)
    throw new Error("Sync requires one local side and one remote side");
  const s = await sftp(a.server),
    rules = exclusions(a.exclude),
    excluded = (rel) =>
      rules.some((r) => r.test(rel) || r.test(path.posix.basename(rel)));
  const local = {
    join: path.join,
    async stat(p) {
      return fs.promises.lstat(p);
    },
    async list(p) {
      return fs.promises.readdir(p);
    },
    async mkdir(p) {
      await fs.promises.mkdir(p, { recursive: true });
    },
    async remove(p, dir) {
      await fs.promises[dir ? "rmdir" : "unlink"](p);
    },
    async digest(p) {
      return hash(fs.createReadStream(p));
    },
  };
  const remote = {
    join: path.posix.join,
    async stat(p) {
      return sftpCall(s, "lstat", p);
    },
    async list(p) {
      return (await sftpCall(s, "readdir", p))
        .map((e) => e.filename)
        .filter((x) => x !== "." && x !== "..");
    },
    async mkdir(p) {
      try {
        const st = await this.stat(p);
        if (!st.isDirectory())
          throw new Error("Destination is not a directory");
      } catch (e) {
        if (e.code !== 2) throw e;
        const parent = path.posix.dirname(p);
        if (parent !== p) await this.mkdir(parent);
        await sftpCall(s, "mkdir", p);
      }
    },
    async remove(p, dir) {
      await sftpCall(s, dir ? "rmdir" : "unlink", p);
    },
    async digest(p) {
      return hash(s.createReadStream(p));
    },
  };
  const src = srcType === "local" ? local : remote,
    dst = dstType === "local" ? local : remote;
  const srcRoot =
      srcType === "local"
        ? path.resolve(source)
        : await remotePath(a.server, source),
    dstRoot =
      dstType === "local"
        ? path.resolve(destination)
        : await remotePath(a.server, destination);
  if (
    a.delete &&
    (!dstRoot ||
      dstRoot === "/" ||
      /^[a-z]:\/?$/i.test(dstRoot) ||
      [".", "~"].includes(destination))
  )
    throw new Error("Refusing delete against a root or home directory");
  const plan = [];
  let bytes = 0;
  const maybeStat = async (side, p) => {
    try {
      return await side.stat(p);
    } catch (e) {
      if (e.code === "ENOENT" || e.code === 2) return null;
      throw e;
    }
  };
  async function remove(p, rel) {
    check();
    const st = await dst.stat(p);
    if (st.isSymbolicLink())
      throw new Error("Refusing symlink deletion: " + rel);
    if (st.isDirectory())
      for (const n of await dst.list(p)) {
        if (excluded(rel + "/" + n)) continue;
        await remove(dst.join(p, n), rel + "/" + n);
      }
    plan.push({ action: "delete", path: rel });
    if (!a.dryRun) await dst.remove(p, st.isDirectory());
  }
  async function visit(from, to, rel) {
    check();
    if (rel && excluded(rel)) return;
    const st = await src.stat(from);
    if (st.isSymbolicLink())
      throw new Error("Symlinks are not followed: " + rel);
    const target = await maybeStat(dst, to);
    if (target?.isSymbolicLink())
      throw new Error("Destination symlink refused: " + rel);
    if (st.isDirectory()) {
      if (target && !target.isDirectory())
        throw new Error("File/directory collision: " + rel);
      if (!target) {
        plan.push({ action: "mkdir", path: rel });
        if (!a.dryRun) await dst.mkdir(to);
      }
      const names = await src.list(from);
      for (const n of names)
        await visit(
          src.join(from, n),
          dst.join(to, n),
          rel ? rel + "/" + n : n,
        );
      if (a.delete && target)
        for (const n of await dst.list(to)) {
          const child = rel ? rel + "/" + n : n;
          if (!names.includes(n) && !excluded(child))
            await remove(dst.join(to, n), child);
        }
    } else if (st.isFile()) {
      if (target?.isDirectory())
        throw new Error("File/directory collision: " + rel);
      const same =
        target &&
        st.size === target.size &&
        (a.checksum
          ? (await src.digest(from)) === (await dst.digest(to))
          : Math.abs(
              Number(st.mtimeMs ?? st.mtime * 1000) -
                Number(target.mtimeMs ?? target.mtime * 1000),
            ) < 2000);
      if (!same) {
        plan.push({ action: "copy", path: rel, bytes: st.size });
        bytes += st.size;
        if (!a.dryRun) {
          if (srcType === "local") await sftpCall(s, "fastPut", from, to);
          else await sftpCall(s, "fastGet", from, to);
          const modified = Math.floor(
            Number(st.mtimeMs ?? st.mtime * 1000) / 1000,
          );
          if (dstType === "remote")
            await sftpCall(s, "utimes", to, modified, modified);
          else await fs.promises.utimes(to, modified, modified);
        }
      }
    } else throw new Error("Unsupported special file: " + rel);
  }
  await visit(srcRoot, dstRoot, "");
  return {
    success: true,
    dryRun: !!a.dryRun,
    source: srcRoot,
    destination: dstRoot,
    transport: "sftp",
    compression: false,
    compressionNote:
      "SSH/SFTP backend; rsync flags retain compatibility, wire compression is not negotiated",
    bytes,
    changes: plan,
  };
}
