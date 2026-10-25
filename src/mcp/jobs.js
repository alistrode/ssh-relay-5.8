import { connect } from "./transport.js";
import { createRequire } from "node:module";
import { durableJob } from "./durable-exec.js";
const { jobHash } = createRequire(import.meta.url)("../pro/task-jobs.cjs");
export const jobSourceHash = jobHash;
export async function job(server, name, args, timeout = 30000) {
  const target = (await connect(server)).config;
  if (!target.agentDeviceId || !target.capabilities.persistentExec || target.capabilities.taskProtocol !== 55 || !target.capabilities.taskJobs?.[name])
    throw Object.assign(Error("Only the 5.5 controlled job endpoint is supported"), { code: "RELEASE_MISMATCH" });
  const sourceHash = jobHash(name);
  if (sourceHash !== target.capabilities.taskJobs[name]) throw Object.assign(Error("5.5 controlled job versions differ"), { code: "JOB_VERSION_MISMATCH" });
  return durableJob(server, name, args, timeout, sourceHash);
}
