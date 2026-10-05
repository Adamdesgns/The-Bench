import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { safeEqual, sha256 } from "./canonical.js";

export const CLIENT_IDS = ["chatgpt", "claude", "grok"];

export class ClientRegistry {
  constructor(root) {
    this.path = join(root, "clients.json");
  }

  configured() { return existsSync(this.path); }

  read() {
    if (!this.configured()) return { schema_version: "xecutor-clients-v1", clients: [] };
    const config = JSON.parse(readFileSync(this.path, "utf8"));
    if (config.schema_version !== "xecutor-clients-v1" || !Array.isArray(config.clients)) {
      throw new Error("invalid The Xecutor client registry");
    }
    return config;
  }

  authenticate(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
    if (!match) return null;
    const candidateHash = sha256(match[1]);
    for (const client of this.read().clients) {
      if (client.enabled !== false && safeEqual(client.token_sha256, candidateHash)) return client.id;
    }
    return null;
  }
}

function normalizeOwnerCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export class OwnerRegistry {
  constructor(root) { this.path = join(root, "owner.json"); }
  configured() { return existsSync(this.path); }
  read() {
    if (!this.configured()) return null;
    const config = JSON.parse(readFileSync(this.path, "utf8"));
    if (config.schema_version !== "xecutor-owner-v1" || !config.salt || !config.code_scrypt) throw new Error("invalid The Xecutor owner registry");
    return config;
  }
  verify(code) {
    const config = this.read();
    if (!config) return false;
    const normalized = normalizeOwnerCode(code);
    if (normalized.length < 12 || normalized.length > 32) return false;
    const derived = scryptSync(normalized, Buffer.from(config.salt, "hex"), 32).toString("hex");
    return safeEqual(config.code_scrypt, derived);
  }
}

export function initializeOwnerRegistry(root) {
  mkdirSync(root, { recursive: true });
  const path = join(root, "owner.json");
  if (existsSync(path)) throw new Error(`owner registry already exists at ${path}; no overwrite performed`);
  const normalized = randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(12, "X").slice(0, 12);
  const code = normalized.match(/.{1,4}/g).join("-");
  const salt = randomBytes(16);
  const record = {
    schema_version: "xecutor-owner-v1",
    salt: salt.toString("hex"),
    code_scrypt: scryptSync(normalized, salt, 32).toString("hex"),
    created_at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { path, code };
}

export function initializeClientRegistry(root) {
  mkdirSync(root, { recursive: true });
  const path = join(root, "clients.json");
  if (existsSync(path)) throw new Error(`client registry already exists at ${path}; no overwrite performed`);
  const issued = [];
  const clients = CLIENT_IDS.map((id) => {
    const token = `xct_${id}_${randomBytes(24).toString("base64url")}`;
    issued.push({ id, token });
    return { id, token_sha256: sha256(token), enabled: true, created_at: new Date().toISOString() };
  });
  writeFileSync(path, `${JSON.stringify({ schema_version: "xecutor-clients-v1", clients }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { path, issued };
}
