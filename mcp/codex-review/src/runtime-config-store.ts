import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import * as TOML from "@iarna/toml";

import {
  parseConfigText,
  type LoadedConfig,
  type ResolvedConfig,
} from "./config.js";

export interface ConfigInspection {
  configPath: string;
  realPath: string;
  text: string;
  sha256: string;
  raw: unknown;
  observedSchema: number | undefined;
}

export interface ValidatedConfigSnapshot extends ConfigInspection {
  config: ResolvedConfig;
  loaded: LoadedConfig;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Read-through config store. It intentionally has no parsed-config cache: every public tool
 * invocation gets a fresh disk read and sha, so flow/tier/disable changes take effect without a
 * bridge restart. Bundle/tool registration still requires reconnecting the MCP process.
 */
export class RuntimeConfigStore {
  constructor(readonly configPath: string) {}

  inspect(): ConfigInspection {
    const stat = lstatSync(this.configPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`config must be a regular non-symlink file: ${this.configPath}`);
    }
    const text = readFileSync(this.configPath, "utf8");
    const raw = TOML.parse(text);
    const meta =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).meta
        : undefined;
    const observed =
      typeof meta === "object" && meta !== null
        ? (meta as Record<string, unknown>).control_surface_schema
        : undefined;
    return {
      configPath: this.configPath,
      realPath: realpathSync(this.configPath),
      text,
      sha256: sha256Text(text),
      raw,
      observedSchema:
        typeof observed === "number" && Number.isInteger(observed)
          ? observed
          : undefined,
    };
  }

  loadValidated(): ValidatedConfigSnapshot {
    const inspection = this.inspect();
    // Validate the exact bytes whose sha is returned. Re-reading by path here would create a
    // split snapshot under a concurrent writer (sha/raw from A, resolved config from B).
    const loaded = parseConfigText(inspection.text, this.configPath);
    return {
      ...inspection,
      config: loaded.config,
      loaded,
    };
  }
}
