module.exports = async function (ARGS) {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    crypto = require("node:crypto"),
    cp = require("node:child_process");
  const home = (p) =>
    !p
      ? path.join(os.homedir(), ".relay-mcp", "backups")
      : p === "~"
        ? os.homedir()
        : p.startsWith("~/")
          ? path.join(os.homedir(), p.slice(2))
          : path.resolve(p);
  const dir = home(ARGS.backupDir);
  const exec = (bin, args) => {
    const r = cp.spawnSync(bin, args, {
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    if (r.error) throw r.error;
    if (r.status !== 0)
      throw new Error(bin + " failed (" + r.status + "): " + r.stderr);
    return r.stdout;
  };
  const digest = (p) => {
    const h = crypto.createHash("sha256");
    const fd = fs.openSync(p, "r");
    try {
      const b = Buffer.alloc(65536);
      let n;
      while ((n = fs.readSync(fd, b, 0, b.length, null)))
        h.update(b.subarray(0, n));
      return h.digest("hex");
    } finally {
      fs.closeSync(fd);
    }
  };
  const entries = () =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((n) => n.endsWith(".meta.json"))
          .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")))
      : [];
  if (ARGS.action === "list")
    return {
      success: true,
      backupDir: dir,
      backups: entries()
        .filter((m) => !ARGS.type || m.type === ARGS.type)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  if (ARGS.action === "create") {
    if (!Number.isInteger(ARGS.retention ?? 7) || (ARGS.retention ?? 7) < 1)
      throw new Error("retention must be a positive integer");
    if (!["files", "full"].includes(ARGS.type))
      throw new Error("Database backup must use the database adapter");
    if (!ARGS.paths?.length)
      throw new Error(
        "Explicit paths required, including full backups; no implicit whole-disk backup",
      );
    if (!/^[a-zA-Z0-9_-]+$/.test(ARGS.name))
      throw new Error(
        "Backup name must contain letters, digits, dash or underscore",
      );
    const paths = ARGS.paths.map(home);
    for (const p of paths) {
      if (!fs.existsSync(p)) throw new Error("Missing backup source " + p);
      if (fs.lstatSync(p).isSymbolicLink())
        throw new Error("Backup source symlink refused");
      if (dir === p || dir.startsWith(p + path.sep))
        throw new Error("Backup directory cannot be inside a source");
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id =
      ARGS.type +
      "_" +
      ARGS.name +
      "_" +
      Date.now() +
      "_" +
      crypto.randomBytes(4).toString("hex");
    const file = path.join(
      dir,
      id + (ARGS.compress === false ? ".tar" : ".tar.gz"),
    );
    const archiveArgs = [ARGS.compress === false ? "-cf" : "-czf", file];
    for (const p of ARGS.exclude || []) archiveArgs.push("--exclude", p);
    for (const p of paths)
      archiveArgs.push("-C", path.dirname(p), path.basename(p));
    try {
      exec("tar", archiveArgs);
    } catch (e) {
      fs.rmSync(file, { force: true });
      throw e;
    }
    const meta = {
      id,
      type: ARGS.type,
      name: ARGS.name,
      createdAt: new Date().toISOString(),
      file,
      paths,
      bytes: fs.statSync(file).size,
      sha256: digest(file),
      retention: ARGS.retention ?? 7,
    };
    fs.writeFileSync(
      path.join(dir, id + ".meta.json"),
      JSON.stringify(meta, null, 2),
      { mode: 0o600 },
    );
    // Retention affects only validated manifests and their sibling archives for this backup name.
    for (const old of entries()) {
      if (old.id === id || old.name !== meta.name || old.type !== meta.type)
        continue;
      if (
        Date.now() - Date.parse(old.createdAt) >
          (ARGS.retention ?? 7) * 86400000 &&
        path.dirname(old.file) === dir &&
        path.basename(old.file).startsWith(old.id + ".")
      ) {
        fs.rmSync(old.file, { force: true });
        fs.rmSync(path.join(dir, old.id + ".meta.json"));
      }
    }
    return { success: true, backup: meta };
  }
  if (["restore", "verify"].includes(ARGS.action)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(ARGS.backupId))
      throw new Error("Invalid backup ID");
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, ARGS.backupId + ".meta.json"), "utf8"),
    );
    if (path.dirname(meta.file) !== dir || digest(meta.file) !== meta.sha256)
      throw new Error("Backup path or checksum verification failed");
    if (ARGS.action === "verify") return { success: true, backup: meta };
    if (!ARGS.targetPath)
      throw new Error("Explicit targetPath required for file restore");
    const target = home(ARGS.targetPath);
    if (target === path.parse(target).root)
      throw new Error("Refusing filesystem-root restore");
    const listing = exec("tar", ["-tf", meta.file])
      .split(/\r?\n/)
      .filter(Boolean);
    for (const n of listing)
      if (
        /^(\/|\\|[a-z]:)/i.test(n) ||
        n.replaceAll("\\", "/").split("/").includes("..")
      )
        throw new Error("Unsafe archive entry");
    // Inspect entry types before extraction; links could redirect subsequent entries outside target.
    const verbose = exec("tar", ["-tvf", meta.file]);
    if (verbose.split(/\r?\n/).some((n) => /^[lh]/.test(n)))
      throw new Error("Archive contains links; refusing automated restore");
    // Reject pre-existing links in the extraction path as well as links inside the archive.
    for (const name of ["", ...listing]) {
      const candidate = path.resolve(target, name);
      if (candidate !== target && !candidate.startsWith(target + path.sep))
        throw new Error("Archive escapes target");
      let current = candidate;
      while (current !== path.parse(current).root) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
          throw new Error("Restore target contains a symlink");
        current = path.dirname(current);
      }
    }
    fs.mkdirSync(target, { recursive: true });
    exec("tar", ["-xf", meta.file, "-C", target]);
    return {
      success: true,
      id: meta.id,
      targetPath: target,
      verifiedSha256: meta.sha256,
    };
  }
  throw new Error("Unknown backup action");
};
