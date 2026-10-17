module.exports = async function (ARGS) {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    cp = require("node:child_process"),
    crypto = require("node:crypto"),
    zlib = require("node:zlib");
  const { pipeline } = require("node:stream/promises");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-db-"));
  const env = { ...process.env };
  const quoteIdentifier = (s) => '"' + String(s).replaceAll('"', '""') + '"';
  const command = (bin, args, { input, output } = {}) => {
    let infd, outfd;
    try {
      infd = input ? fs.openSync(input, "r") : null;
      outfd = output ? fs.openSync(output, "w", 0o600) : null;
      const r = cp.spawnSync(bin, args, {
        env,
        encoding: output ? undefined : "utf8",
        timeout: 240000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        stdio: [infd ?? "ignore", outfd ?? "pipe", "pipe"],
      });
      if (r.error)
        throw new Error(
          bin +
            ": " +
            r.error.message +
            "; install the matching database client on the remote if missing",
        );
      if (r.status !== 0)
        throw new Error(
          bin + " exited " + r.status + ": " + String(r.stderr).slice(0, 2000),
        );
      return String(r.stdout || "");
    } finally {
      if (infd !== null && infd !== undefined) fs.closeSync(infd);
      if (outfd !== null && outfd !== undefined) fs.closeSync(outfd);
    }
  };
  const home = (p) =>
    p?.startsWith("~/")
      ? path.join(os.homedir(), p.slice(2))
      : p
        ? path.resolve(p)
        : path.join(os.homedir(), ".relay-mcp", "backups");
  const digest = (p) =>
    new Promise((resolve, reject) => {
      const h = crypto.createHash("sha256");
      const r = fs.createReadStream(p);
      r.on("data", (d) => h.update(d));
      r.on("error", reject);
      r.on("end", () => resolve(h.digest("hex")));
    });
  try {
    if (!["mysql", "postgresql", "mongodb"].includes(ARGS.type))
      throw new Error("Invalid database type");
    const port =
      ARGS.dbPort ??
      { mysql: 3306, postgresql: 5432, mongodb: 27017 }[ARGS.type];
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid database port");
    const host = ARGS.dbHost || "localhost";
    if (!["localhost", "127.0.0.1", "::1"].includes(host))
      throw new Error(
        "Database host must be loopback; LAN functions are excluded",
      );
    for (const k of ["database", "dbUser", "collection"])
      if (
        ARGS[k] !== undefined &&
        (ARGS[k].startsWith("-") ||
          ARGS[k].includes("\0") ||
          ARGS[k].includes("\n"))
      )
        throw new Error("Invalid " + k);
    if (
      ARGS.tables?.some(
        (t) => typeof t !== "string" || t.startsWith("-") || /[\0\r\n]/.test(t),
      )
    )
      throw new Error("Invalid table name");
    if (ARGS.action === "query" && ARGS.type !== "mongodb") {
      const q = ARGS.query || "";
      if (
        !/^\s*select\b/i.test(q) ||
        /;|--|\/\*|\b(into|outfile|dumpfile|for\s+update|insert|delete|update|drop|alter|create|grant|exec|copy|pg_sleep|load_file)\b/i.test(
          q,
        )
      )
        throw new Error("Only a single read-only SELECT query is supported");
    }
    let action = ARGS.action,
      meta = null,
      outputFile = ARGS.outputFile;
    if (action === "backup") {
      if (!Number.isInteger(ARGS.retention ?? 7) || (ARGS.retention ?? 7) < 1)
        throw new Error("retention must be a positive integer");
      if (!/^[a-zA-Z0-9_-]+$/.test(ARGS.name))
        throw new Error("Invalid backup name");
      const dir = home(ARGS.backupDir);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const id =
        ARGS.type +
        "_" +
        ARGS.name +
        "_" +
        Date.now() +
        "_" +
        crypto.randomBytes(4).toString("hex");
      outputFile = path.join(
        dir,
        id + ".dump" + (ARGS.compress === false ? "" : ".gz"),
      );
      meta = {
        id,
        type: ARGS.type,
        name: ARGS.name,
        database: ARGS.database,
        file: outputFile,
        createdAt: new Date().toISOString(),
      };
      action = "dump";
    }
    if (["dump", "import", "query"].includes(action) && !ARGS.database)
      throw new Error("database is required");
    let mysql = [],
      pg = [],
      mongo = [];
    if (ARGS.type === "mysql") {
      const esc = (s) =>
        '"' +
        String(s)
          .replaceAll("\\", "\\\\")
          .replaceAll('"', '\\"')
          .replaceAll("\n", "\\n") +
        '"';
      const f = path.join(tmp, "mysql.cnf");
      fs.writeFileSync(
        f,
        "[client]\n" +
          (ARGS.dbUser ? "user=" + esc(ARGS.dbUser) + "\n" : "") +
          (ARGS.dbPassword !== undefined
            ? "password=" + esc(ARGS.dbPassword) + "\n"
            : ""),
        { mode: 0o600 },
      );
      mysql = [
        "--defaults-extra-file=" + f,
        "--host=" + host,
        "--port=" + port,
      ];
    } else if (ARGS.type === "postgresql") {
      if (ARGS.dbPassword !== undefined) env.PGPASSWORD = ARGS.dbPassword;
      pg = [
        "-h",
        host,
        "-p",
        String(port),
        ...(ARGS.dbUser ? ["-U", ARGS.dbUser] : []),
      ];
    } else {
      const f = path.join(tmp, "mongo.yaml");
      fs.writeFileSync(
        f,
        JSON.stringify({
          ...(ARGS.dbPassword !== undefined
            ? { password: ARGS.dbPassword }
            : {}),
        }),
        { mode: 0o600 },
      );
      mongo = [
        "--host",
        host,
        "--port",
        String(port),
        ...(ARGS.dbUser ? ["--username", ARGS.dbUser] : []),
        ...(ARGS.dbPassword !== undefined ? ["--config", f] : []),
      ];
    }
    if (action === "list" || action === "query") {
      let output;
      if (ARGS.type === "mysql") {
        const sql =
          action === "query"
            ? "START TRANSACTION READ ONLY;\n" + ARGS.query + ";\nROLLBACK;"
            : ARGS.database
              ? "SHOW TABLES;"
              : "SHOW DATABASES;";
        const f = path.join(tmp, "query.sql");
        fs.writeFileSync(f, sql);
        output = command(
          "mysql",
          [
            ...mysql,
            "--batch",
            "--raw",
            ...(ARGS.database ? ["--database=" + ARGS.database] : []),
          ],
          { input: f },
        );
      } else if (ARGS.type === "postgresql") {
        const sql =
          action === "query"
            ? "BEGIN READ ONLY;\n" + ARGS.query + ";\nROLLBACK;"
            : ARGS.database
              ? "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"
              : "SELECT datname FROM pg_database WHERE datistemplate = false;";
        const f = path.join(tmp, "query.sql");
        fs.writeFileSync(f, sql);
        output = command("psql", [
          ...pg,
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          ARGS.database || "postgres",
          "-f",
          f,
        ]);
      } else {
        const auth = ARGS.dbUser
          ? encodeURIComponent(ARGS.dbUser) +
            ":" +
            encodeURIComponent(ARGS.dbPassword || "") +
            "@"
          : "";
        const uri =
          "mongodb://" +
          auth +
          (host === "::1" ? "[::1]" : host) +
          ":" +
          port +
          "/" +
          encodeURIComponent(ARGS.database || "admin") +
          "?authSource=admin";
        const body =
          action === "list"
            ? ARGS.database
              ? "printjson(db.getCollectionNames());"
              : "printjson(db.adminCommand({listDatabases:1,nameOnly:true}));"
            : (() => {
                if (!ARGS.collection) throw new Error("collection required");
                const filter = JSON.parse(ARGS.query || "{}");
                const scan = (v) => {
                  if (v && typeof v === "object")
                    for (const [k, val] of Object.entries(v)) {
                      if (["$where", "$function", "$accumulator"].includes(k))
                        throw new Error(
                          "Executable MongoDB expressions refused",
                        );
                      scan(val);
                    }
                };
                scan(filter);
                return (
                  "printjson(db.getCollection(" +
                  JSON.stringify(ARGS.collection) +
                  ").find(" +
                  JSON.stringify(filter) +
                  ").limit(1000).toArray());"
                );
              })();
        const f = path.join(tmp, "query.js");
        fs.writeFileSync(f, "db=connect(" + JSON.stringify(uri) + ");" + body, {
          mode: 0o600,
        });
        output = command("mongosh", ["--nodb", "--quiet", "--file", f]);
      }
      return {
        success: true,
        type: ARGS.type,
        database: ARGS.database || null,
        output,
      };
    }
    if (action === "dump") {
      if (!outputFile) throw new Error("outputFile is required");
      outputFile = home(outputFile);
      const raw = path.join(tmp, "dump.raw");
      if (ARGS.type === "mysql")
        command(
          "mysqldump",
          [
            ...mysql,
            "--single-transaction",
            ARGS.database,
            ...(ARGS.tables || []),
          ],
          { output: raw },
        );
      else if (ARGS.type === "postgresql")
        command(
          "pg_dump",
          [
            ...pg,
            "-d",
            ARGS.database,
            ...(ARGS.tables || []).flatMap((t) => ["-t", t]),
          ],
          { output: raw },
        );
      else
        command("mongodump", [
          ...mongo,
          "--db",
          ARGS.database,
          "--archive=" + raw,
        ]);
      const partial =
        outputFile + ".partial-" + crypto.randomBytes(4).toString("hex");
      try {
        if (ARGS.compress !== false)
          await pipeline(
            fs.createReadStream(raw),
            zlib.createGzip(),
            fs.createWriteStream(partial, { mode: 0o600 }),
          );
        else fs.copyFileSync(raw, partial);
        fs.renameSync(partial, outputFile);
      } finally {
        fs.rmSync(partial, { force: true });
      }
      if (meta) {
        meta.bytes = fs.statSync(outputFile).size;
        meta.sha256 = await digest(outputFile);
        fs.writeFileSync(
          path.join(path.dirname(outputFile), meta.id + ".meta.json"),
          JSON.stringify(meta, null, 2),
          { mode: 0o600 },
        );
        const dir = path.dirname(outputFile);
        for (const n of fs
          .readdirSync(dir)
          .filter((n) => n.endsWith(".meta.json"))) {
          const old = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
          if (
            old.id !== meta.id &&
            old.name === meta.name &&
            old.type === meta.type &&
            Date.now() - Date.parse(old.createdAt) >
              (ARGS.retention ?? 7) * 86400000 &&
            path.dirname(old.file) === dir &&
            path.basename(old.file).startsWith(old.id + ".")
          ) {
            fs.rmSync(old.file, { force: true });
            fs.rmSync(path.join(dir, n));
          }
        }
      }
      return {
        success: true,
        outputFile,
        bytes: fs.statSync(outputFile).size,
        sha256: await digest(outputFile),
        compressed: ARGS.compress !== false,
        ...(meta ? { backup: meta } : {}),
      };
    }
    if (action === "import") {
      let input = home(ARGS.inputFile);
      const head = Buffer.alloc(2);
      const fd = fs.openSync(input, "r");
      try {
        fs.readSync(fd, head, 0, 2, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (head[0] === 0x1f && head[1] === 0x8b) {
        const raw = path.join(tmp, "import.raw");
        await pipeline(
          fs.createReadStream(input),
          zlib.createGunzip(),
          fs.createWriteStream(raw, { mode: 0o600 }),
        );
        input = raw;
      }
      if (ARGS.type === "mysql")
        command("mysql", [...mysql, "--database=" + ARGS.database], { input });
      else if (ARGS.type === "postgresql")
        command(
          "psql",
          [...pg, "-X", "-v", "ON_ERROR_STOP=1", "-d", ARGS.database],
          { input },
        );
      else
        command("mongorestore", [
          ...mongo,
          "--db",
          ARGS.database,
          "--archive=" + input,
          ...(ARGS.drop === false ? [] : ["--drop"]),
        ]);
      return {
        success: true,
        type: ARGS.type,
        database: ARGS.database,
        inputFile: ARGS.inputFile,
      };
    }
    throw new Error("Unknown database action");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
