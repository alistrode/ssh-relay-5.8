import fs from "node:fs";
import zlib from "node:zlib";
import { run, sftp, sftpCall, psQuote, powershell } from "./transport.js";
import { serverConfig } from "./config.js";
import { shellQuote } from "./shell-quote.js";
import crypto from "node:crypto";
export async function job(server, name, args, timeout = 30000) {
  const source = fs.readFileSync(
    new URL("./jobs/" + name + ".cjs", import.meta.url),
    "utf8",
  );
  const script = `(async()=>{const module={exports:null};(function(module){${source}\n})(module);return module.exports(${JSON.stringify(args)});})().then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});`;
  const b64 = zlib.gzipSync(Buffer.from(script)).toString("base64");
  const config = serverConfig(server),
    win = config.platform === "windows";
  const executable = config.capabilities.nodeExecutable || "node";
  const nodePrefix =
    config.capabilities.nodeMode === "electron"
      ? win
        ? "$env:ELECTRON_RUN_AS_NODE='1'; "
        : "ELECTRON_RUN_AS_NODE=1 "
      : "";
  const nodeCommand =
    nodePrefix + (win ? "& " + psQuote(executable) : shellQuote(executable));
  const expression = `eval(require('node:zlib').gunzipSync(Buffer.from('${b64}','base64')).toString())`;
  const command =
    nodeCommand + " -e " + (win ? psQuote(expression) : shellQuote(expression));
  let result;
  // Encoded command lines are reversible: credentials must travel only via SFTP
  // into a private temporary job, never even as gzip/base64 process arguments.
  let needsFile =
    command.length > 7800 ||
    args.dbPassword !== undefined ||
    args.password !== undefined;
  if (serverConfig(server).platform === "windows" && !needsFile) {
    try {
      powershell(command);
    } catch (error) {
      if (!error.message.includes("too large")) throw error;
      needsFile = true;
    }
  }
  if (needsFile) {
    const s = await sftp(server);
    const home = await sftpCall(s, "realpath", ".");
    const file =
      home + "/.relay-job-" + crypto.randomBytes(12).toString("hex") + ".cjs";
    try {
      await sftpCall(s, "writeFile", file, script, { mode: 0o600 });
      const win = serverConfig(server).platform === "windows";
      const local = win ? file.replace(/^\/([a-z]:\/)/i, "$1") : file;
      result = await run(
        server,
        nodeCommand + " " + (win ? psQuote(local) : shellQuote(local)),
        { timeout },
      );
    } finally {
      await sftpCall(s, "unlink", file).catch(() => {});
    }
  } else result = await run(server, command, { timeout });
  if (!result.success) return result;
  try {
    return { ...JSON.parse(result.stdout), code: result.code };
  } catch {
    throw new Error(
      "Remote job did not return valid JSON (exit " +
        result.code +
        "): " +
        result.stdout.slice(0, 300) +
        " stderr: " +
        result.stderr.slice(0, 300),
    );
  }
}
