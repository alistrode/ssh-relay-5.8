module.exports = async function (ARGS) {
  // Runs on the verified remote using its existing Node.js runtime.
  const os = require("node:os");
  const cpu = () =>
    os.cpus().reduce(
      (a, c) => {
        a.idle += c.times.idle;
        a.total += Object.values(c.times).reduce((x, y) => x + y, 0);
        return a;
      },
      { idle: 0, total: 0 },
    );
  async function sample() {
    const before = cpu();
    await new Promise((r) => setTimeout(r, 500));
    const after = cpu();
    const memory = {
      total: os.totalmem(),
      free: os.freemem(),
      usedPercent: 100 * (1 - os.freemem() / os.totalmem()),
    };
    const disk = [];
    let network = null, networkError;
    try { network = os.networkInterfaces(); }
    catch { networkError = "NETWORK_INTERFACES_UNAVAILABLE"; }
    return {
      hostname: os.hostname(),
      account: os.userInfo().username,
      platform: process.platform,
      uptime: os.uptime(),
      load: os.loadavg(),
      cpuPercent:
        after.total === before.total
          ? 0
          : 100 *
            (1 - (after.idle - before.idle) / (after.total - before.total)),
      memory,
      disk,
      network,
      ...(networkError ? { networkError } : {}),
      timestamp: new Date().toISOString(),
    };
  }
  const count = ARGS.duration
    ? Math.max(1, Math.ceil(ARGS.duration / (ARGS.interval || 2)))
    : 1;
  if (count > 120 || ARGS.duration > 240)
    throw new Error("Monitoring limited to 120 samples / 240 seconds per call");
  const samples = [];
  for (let i = 0; i < count; i++) {
    samples.push(await sample());
    if (i < count - 1)
      await new Promise((r) => setTimeout(r, (ARGS.interval || 2) * 1000));
  }
  return { success: true, samples };
};

