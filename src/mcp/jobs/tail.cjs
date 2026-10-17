module.exports = async function (ARGS) {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const file = ARGS.file.startsWith("~/")
    ? path.join(os.homedir(), ARGS.file.slice(2))
    : ARGS.file;
  const lines = ARGS.lines ?? 10;
  if (!Number.isInteger(lines) || lines < 0 || lines > 10000)
    throw new Error("lines must be 0..10000");
  const filter = ARGS.grep ? new RegExp(ARGS.grep) : null;
  const read = () => {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    try {
      const n = Math.min(size, 2 * 1024 * 1024),
        b = Buffer.alloc(n);
      fs.readSync(fd, b, 0, n, size - n);
      return { size, text: b.toString("utf8") };
    } finally {
      fs.closeSync(fd);
    }
  };
  let snapshot = read(),
    position = snapshot.size;
  const initial = snapshot.text.split(/\r?\n/);
  if (initial.at(-1) === "") initial.pop();
  const output = initial
    .slice(-lines || initial.length)
    .filter((l) => !filter || filter.test(l));
  if (lines === 0) output.length = 0;
  if (ARGS.follow !== false) {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const size = fs.statSync(file).size;
      if (size < position) position = 0;
      if (size > position) {
        const n = Math.min(size - position, 2 * 1024 * 1024);
        const fd = fs.openSync(file, "r");
        try {
          const b = Buffer.alloc(n);
          fs.readSync(fd, b, 0, n, position);
          output.push(
            ...b
              .toString("utf8")
              .split(/\r?\n/)
              .filter((l) => l && (!filter || filter.test(l))),
          );
        } finally {
          fs.closeSync(fd);
        }
        position = size;
      }
    }
  }
  return {
    success: true,
    file,
    output: output.join("\n"),
    follow: ARGS.follow !== false,
    followWindowSeconds: ARGS.follow === false ? 0 : 5,
    offset: position,
    note: "Follow is bounded to five seconds per MCP call; call again to obtain a fresh window. No background stream is left running.",
  };
};
