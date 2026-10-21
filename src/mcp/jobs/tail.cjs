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
  const identity = stat => String(stat.dev) + ":" + String(stat.ino);
  const initialStat = fs.statSync(file);
  const fileIdentity = identity(initialStat);
  let rotated = false;
  const savedCursor = ARGS.cursor;
  const resume = savedCursor && savedCursor.fileIdentity === fileIdentity && Number.isSafeInteger(savedCursor.offset) && savedCursor.offset >= 0 && savedCursor.offset <= initialStat.size;
  let carry = resume && typeof savedCursor.pendingUTF8 === "string" && /^[A-Za-z0-9+/=]{0,4}$/.test(savedCursor.pendingUTF8)
    ? Buffer.from(savedCursor.pendingUTF8, "base64") : Buffer.alloc(0);
  if (carry.length > 3) throw Error("Invalid tail UTF-8 cursor");
  const decode = input => {
    const bytes = Buffer.concat([carry, input]); let end = bytes.length;
    let start = bytes.length - 1;
    while (start >= Math.max(0, bytes.length - 4) && (bytes[start] & 0xc0) === 0x80) start--;
    if (start >= 0) {
      const c = bytes[start], need = c >= 0xc2 && c <= 0xdf ? 2 : c >= 0xe0 && c <= 0xef ? 3 : c >= 0xf0 && c <= 0xf4 ? 4 : 1;
      if (need > bytes.length - start) end = start;
    }
    carry = Buffer.from(bytes.subarray(end)); return bytes.subarray(0, end).toString("utf8");
  };
  const read = () => {
    const stat = fs.statSync(file), size = stat.size;
    if (identity(stat) !== fileIdentity) throw Error("Log source changed before reading");
    const fd = fs.openSync(file, "r");
    try {
      const n = Math.min(size, 2 * 1024 * 1024),
        b = Buffer.alloc(n);
      const start = resume ? savedCursor.offset : size - n;
      const length = Math.min(size - start, 2 * 1024 * 1024), bytes = Buffer.alloc(length);
      const count = fs.readSync(fd, bytes, 0, length, start);
      return { size: start + count, text: decode(bytes.subarray(0, count)) };
    } finally {
      fs.closeSync(fd);
    }
  };
  let snapshot = read(),
    position = snapshot.size;
  const initial = snapshot.text.split(/\r?\n/);
  if (initial.at(-1) === "") initial.pop();
  const output = initial
    .slice(resume ? 0 : (-lines || initial.length))
    .filter((l) => !filter || filter.test(l));
  if (lines === 0 && !resume) output.length = 0;
  if (ARGS.follow !== false) {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const stat = fs.statSync(file), size = stat.size;
      if (identity(stat) !== fileIdentity) { rotated = true; break; }
      if (size < position) { rotated = true; break; }
      if (size > position) {
        const n = Math.min(size - position, 2 * 1024 * 1024);
        const fd = fs.openSync(file, "r");
        let count = 0;
        try {
          const b = Buffer.alloc(n);
          count = fs.readSync(fd, b, 0, n, position);
          output.push(
            ...decode(b.subarray(0, count))
              .split(/\r?\n/)
              .filter((l) => l && (!filter || filter.test(l))),
          );
        } finally {
          fs.closeSync(fd);
        }
        position += count;
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
    cursor: { fileIdentity, offset: position, pendingUTF8: carry.toString("base64") },
    cursorReset: !!savedCursor && !resume,
    sourceRotated: rotated,
    note: "Follow is bounded to five seconds per MCP call; call again to obtain a fresh window. No background stream is left running.",
  };
};

