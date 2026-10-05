import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const XECUTOR_MODE = "SIMULATION_ONLY";
export const XECUTOR_VERSION = "the-xecutor-stage1-v1";
export const APPROVAL_TTL_MS = 90_000;

export function xecutorDataDir(env = process.env) {
  if (env.XECUTOR_DATA_DIR) return resolve(env.XECUTOR_DATA_DIR);
  const localRoot = env.LOCALAPPDATA || join(homedir(), ".local", "share");
  return resolve(localRoot, "The Xecutor");
}

export function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
