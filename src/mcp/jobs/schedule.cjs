module.exports = async function (ARGS, CONTEXT) {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    cp = require("node:child_process");
  if (!/^[a-zA-Z0-9_-]+$/.test(ARGS.name))
    throw new Error("Invalid schedule name");
  const fields = ARGS.schedule.trim().split(/\s+/);
  const limits = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  if (fields.length !== 5) throw new Error("Expected five numeric cron fields");
  const sets = fields.map((field, i) => {
    const values = new Set();
    for (const part of field.split(",")) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!m)
        throw new Error("Cron supports numeric lists, ranges, * and /step");
      let lo, hi;
      if (m[1] === "*") [lo, hi] = limits[i];
      else (([lo, hi] = m[1].split("-").map(Number)), (hi = hi ?? lo));
      const step = Number(m[2] || 1);
      if (step < 1 || lo < limits[i][0] || hi > limits[i][1] || lo > hi)
        throw new Error("Invalid cron field");
      for (let n = lo; n <= hi; n += step)
        values.add(i === 4 && n === 7 ? 0 : n);
    }
    return [...values];
  });
  const dir = path.join(os.homedir(), ".relay-mcp", "schedules");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, ARGS.name + ".cjs");
  const match = `const now=new Date(),sets=${JSON.stringify(sets)},v=[now.getMinutes(),now.getHours(),now.getDate(),now.getMonth()+1,now.getDay()];const day=sets[2].includes(v[2]),week=sets[4].includes(v[4]);if(!sets[0].includes(v[0])||!sets[1].includes(v[1])||!sets[3].includes(v[3])||!(${JSON.stringify(fields[2] === "*" || fields[4] === "*")}?(day&&week):(day||week)))process.exit(0);`;
  const lock = `const fs=require('node:fs');const lock=__filename+'.lock';try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')process.exit(0);throw e;}process.on('exit',()=>fs.rmSync(lock,{recursive:true,force:true}));`;
  let implementation = ARGS.script;
  if (CONTEXT?.controlled) {
    const registry = require("../../pro/task-jobs.cjs");
    const { normalizeJobSpec } = require("../../pro/task-spec.cjs");
    const spec = normalizeJobSpec(ARGS.controlledJob);
    if (!["backup", "database"].includes(spec.name) || registry.jobHash(spec.name) !== spec.sourceHash)
      throw new Error("Scheduled controlled job version mismatch");
    if (ARGS.script !== undefined) throw new Error("Controlled schedules do not accept implementation source");
    const configuration = file + ".json";
    fs.writeFileSync(configuration, JSON.stringify(spec), { mode: 0o600 });
    const registryPath = require.resolve("../../pro/task-jobs.cjs");
    implementation =
      "const spec=JSON.parse(require('node:fs').readFileSync(__filename+'.json','utf8'));" +
      "const registry=require(" + JSON.stringify(registryPath) + ");" +
      "const source=registry.jobSource(spec.name);" +
      "if(registry.sourceHash(source)!==spec.sourceHash)throw Error('Scheduled module version changed; inspect and re-register the schedule');" +
      "const container={exports:{}};new Function('module','require',source)(container,require('node:module').createRequire(registry.jobFile(spec.name)));" +
      "Promise.resolve(container.exports(spec.args)).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});";
  } else if (typeof implementation !== "string") throw new Error("Missing legacy schedule implementation");
  const runner = match + lock + implementation;
  fs.writeFileSync(file, runner, { mode: 0o600 });
  let result;
  if (process.platform === "win32") {
    result = cp.spawnSync(
      "schtasks.exe",
      [
        "/Create",
        "/F",
        "/SC",
        "MINUTE",
        "/MO",
        "1",
        "/TN",
        "RelayMcp-" + ARGS.name,
        "/TR",
        (process.versions.electron
          ? 'cmd.exe /d /s /c "set ELECTRON_RUN_AS_NODE=1&& '
          : "") +
          '"' +
          process.execPath +
          '" "' +
          file +
          '"' +
          (process.versions.electron ? '"' : ""),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
  } else {
    const prev = cp.spawnSync("crontab", ["-l"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (prev.error)
      throw new Error("crontab unavailable: " + prev.error.message);
    if (prev.status !== 0 && !/no crontab/i.test(prev.stderr))
      throw new Error("Cannot read existing crontab: " + prev.stderr);
    const marker = "# relay-mcp:" + ARGS.name;
    const lines =
      prev.status === 0
        ? prev.stdout.split("\n").filter((x) => !x.endsWith(marker))
        : [];
    const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    lines.push(
      "* * * * * " +
        (process.versions.electron ? "ELECTRON_RUN_AS_NODE=1 " : "") +
        q(process.execPath) +
        " " +
        q(file) +
        " >> " +
        q(file + ".log") +
        " 2>&1 " +
        marker,
    );
    result = cp.spawnSync("crontab", ["-"], {
      input: lines.join("\n") + "\n",
      encoding: "utf8",
      timeout: 10000,
    });
  }
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Schedule registration failed: " + result.stderr);
  return {
    success: true,
    name: ARGS.name,
    schedule: ARGS.schedule,
    runner: file,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    mechanism:
      process.platform === "win32"
        ? "Task Scheduler (current user)"
        : "crontab",
    note: "Runs at matching minutes under the scheduler account; no permission elevation. Requires existing Node and tar/database clients. Remove the scoped task/crontab entry to cancel.",
  };
};

