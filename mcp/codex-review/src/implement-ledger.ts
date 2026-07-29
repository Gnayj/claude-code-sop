import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { ResolvedConfig } from "./config.js";
import {
  resolveControlDir,
  type ImplementWriterKind,
} from "./implement-workspace.js";
import {
  acquireFlock,
  acquisitionDeadline,
} from "./locks.js";

interface DesignLedger {
  writer_kind: ImplementWriterKind;
  dispatch_count: number;
  wall_seconds: number;
  budget_usd: number;
  reservations: Record<
    string,
    {
      utc_day: string;
      reserved_budget_usd: number;
      reserved_wall_seconds: number;
      settled: boolean;
      actual_budget_usd?: number;
      actual_wall_seconds?: number;
    }
  >;
}

interface DailyLedger {
  reserved_budget_usd: number;
  settled_budget_usd: number;
}

export interface ImplementLedgerState {
  schema_version: 1;
  last_utc_day: string;
  designs: Record<string, DesignLedger>;
  days: Record<string, DailyLedger>;
}

export interface LedgerReservation {
  designId: string;
  artifactId: string;
  utcDay: string;
  reservedBudgetUsd: number;
  reservedWallSeconds: number;
}

function blank(day: string): ImplementLedgerState {
  return {
    schema_version: 1,
    last_utc_day: day,
    designs: Object.create(null) as Record<string, DesignLedger>,
    days: Object.create(null) as Record<string, DailyLedger>,
  };
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function assertFiniteNonnegative(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(`implement ledger has invalid ${field}`);
  }
  return value;
}

function validateLedger(value: unknown): ImplementLedgerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("implement ledger root is not an object");
  }
  const ledger = value as ImplementLedgerState;
  if (ledger.schema_version !== 1) {
    throw new Error(
      `implement ledger has unsupported schema_version=${String(ledger.schema_version)}`,
    );
  }
  if (
    typeof ledger.last_utc_day !== "string" ||
    !ledger.designs ||
    typeof ledger.designs !== "object" ||
    !ledger.days ||
    typeof ledger.days !== "object"
  ) {
    throw new Error("implement ledger is missing required fields");
  }
  for (const [id, design] of Object.entries(ledger.designs)) {
    if (
      !design ||
      (design.writer_kind !== "codex" && design.writer_kind !== "claude") ||
      !design.reservations ||
      typeof design.reservations !== "object"
    ) {
      throw new Error(`implement ledger has invalid design bucket ${id}`);
    }
    assertFiniteNonnegative(design.dispatch_count, `${id}.dispatch_count`);
    assertFiniteNonnegative(design.wall_seconds, `${id}.wall_seconds`);
    assertFiniteNonnegative(design.budget_usd, `${id}.budget_usd`);
  }
  for (const [day, entry] of Object.entries(ledger.days)) {
    assertFiniteNonnegative(entry.reserved_budget_usd, `${day}.reserved`);
    assertFiniteNonnegative(entry.settled_budget_usd, `${day}.settled`);
  }
  return ledger;
}

function writeAtomic(path: string, state: ImplementLedgerState): void {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dirFd = openSync(dirname(path), "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

export class ImplementLedger {
  constructor(
    private readonly repoRoot: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private paths(): { ledger: string; lock: string } {
    const dir = resolveControlDir(this.repoRoot, []);
    return {
      ledger: join(dir, "implement-ledger.json"),
      lock: join(dir, "implement-ledger.lock"),
    };
  }

  private read(
    path: string,
    allowCreate: boolean,
    day: string,
  ): ImplementLedgerState {
    if (!existsSync(path)) {
      if (!allowCreate) {
        throw new Error(
          "implement ledger is absent while implement state already references a dispatch; manual recovery required",
        );
      }
      return blank(day);
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("implement ledger must be a regular non-symlink file");
    }
    const text = readFileSync(path, "utf8");
    try {
      return validateLedger(JSON.parse(text));
    } catch (err) {
      const sha = createHash("sha256").update(text, "utf8").digest("hex");
      const quarantine = `${path}.corrupt.${sha}`;
      if (!existsSync(quarantine)) renameSync(path, quarantine);
      throw new Error(
        `implement ledger is corrupt and was quarantined as ${quarantine}: ${(err as Error).message}`,
      );
    }
  }

  async reserve(input: {
    designId: string;
    artifactId: string;
    writerKind: ImplementWriterKind;
    config: ResolvedConfig["implement"]["claude"];
    allowCreate: boolean;
    lockTimeoutMs: number;
    signal?: AbortSignal;
  }): Promise<LedgerReservation> {
    const paths = this.paths();
    const lock = await acquireFlock(
      paths.lock,
      acquisitionDeadline(input.lockTimeoutMs),
      input.signal,
    );
    try {
      const observedDay = utcDay(this.now());
      const state = this.read(paths.ledger, input.allowCreate, observedDay);
      // A wall-clock rollback never reopens an older, possibly replenished bucket.
      const effectiveDay =
        observedDay < state.last_utc_day ? state.last_utc_day : observedDay;
      if (effectiveDay > state.last_utc_day) state.last_utc_day = effectiveDay;
      const design =
        (Object.prototype.hasOwnProperty.call(state.designs, input.designId)
          ? state.designs[input.designId]
          : undefined) ??
        ({
          writer_kind: input.writerKind,
          dispatch_count: 0,
          wall_seconds: 0,
          budget_usd: 0,
          reservations: Object.create(null),
        } satisfies DesignLedger);
      if (design.writer_kind !== input.writerKind) {
        throw new Error(
          `implement ledger design bucket is owned by writer_kind=${design.writer_kind}`,
        );
      }
      const prior = design.reservations[input.artifactId];
      if (prior) {
        return {
          designId: input.designId,
          artifactId: input.artifactId,
          utcDay: prior.utc_day,
          reservedBudgetUsd: prior.reserved_budget_usd,
          reservedWallSeconds: prior.reserved_wall_seconds,
        };
      }
      const config = input.config;
      if (design.dispatch_count + 1 > config.max_dispatches_per_design) {
        throw new Error(
          `max_dispatches_per_design=${config.max_dispatches_per_design} reached`,
        );
      }
      if (
        design.wall_seconds + config.timeout_seconds >
        config.max_cumulative_wall_seconds
      ) {
        throw new Error(
          `per-design wall budget exhausted (${design.wall_seconds}+${config.timeout_seconds}>${config.max_cumulative_wall_seconds})`,
        );
      }
      if (
        design.budget_usd + config.max_budget_usd >
        config.max_cumulative_budget_usd
      ) {
        throw new Error(
          `per-design USD budget exhausted (${design.budget_usd}+${config.max_budget_usd}>${config.max_cumulative_budget_usd})`,
        );
      }
      const daily =
        state.days[effectiveDay] ??
        ({ reserved_budget_usd: 0, settled_budget_usd: 0 } satisfies DailyLedger);
      if (
        daily.reserved_budget_usd + config.max_budget_usd >
        config.max_daily_budget_usd
      ) {
        throw new Error(
          `daily Claude implement USD budget exhausted for ${effectiveDay}`,
        );
      }
      design.dispatch_count += 1;
      design.wall_seconds += config.timeout_seconds;
      design.budget_usd += config.max_budget_usd;
      design.reservations[input.artifactId] = {
        utc_day: effectiveDay,
        reserved_budget_usd: config.max_budget_usd,
        reserved_wall_seconds: config.timeout_seconds,
        settled: false,
      };
      daily.reserved_budget_usd += config.max_budget_usd;
      Object.defineProperty(state.designs, input.designId, {
        value: design,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      state.days[effectiveDay] = daily;
      writeAtomic(paths.ledger, state);
      return {
        designId: input.designId,
        artifactId: input.artifactId,
        utcDay: effectiveDay,
        reservedBudgetUsd: config.max_budget_usd,
        reservedWallSeconds: config.timeout_seconds,
      };
    } finally {
      lock.release();
    }
  }

  async settle(
    reservation: LedgerReservation,
    actual: { wallSeconds: number; budgetUsd: number },
    lockTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const paths = this.paths();
    const lock = await acquireFlock(
      paths.lock,
      acquisitionDeadline(lockTimeoutMs),
      signal,
    );
    try {
      const state = this.read(paths.ledger, false, reservation.utcDay);
      const design = Object.prototype.hasOwnProperty.call(
        state.designs,
        reservation.designId,
      )
        ? state.designs[reservation.designId]
        : undefined;
      const entry = design?.reservations[reservation.artifactId];
      if (!design || !entry) {
        throw new Error("implement ledger reservation disappeared before settlement");
      }
      if (entry.settled) return;
      const wall = Math.min(
        reservation.reservedWallSeconds,
        assertFiniteNonnegative(actual.wallSeconds, "settlement wall_seconds"),
      );
      // Missing/invalid provider cost is passed by the adapter as the full reservation.
      const budget = Math.max(
        0,
        Math.min(
          reservation.reservedBudgetUsd,
          assertFiniteNonnegative(actual.budgetUsd, "settlement budget_usd"),
        ),
      );
      design.wall_seconds -= reservation.reservedWallSeconds - wall;
      design.budget_usd -= reservation.reservedBudgetUsd - budget;
      entry.actual_wall_seconds = wall;
      entry.actual_budget_usd = budget;
      entry.settled = true;
      const day = state.days[entry.utc_day];
      if (!day) throw new Error("implement ledger daily bucket disappeared");
      day.reserved_budget_usd -= reservation.reservedBudgetUsd - budget;
      day.settled_budget_usd += budget;
      writeAtomic(paths.ledger, state);
    } finally {
      lock.release();
    }
  }

  readForTest(): ImplementLedgerState | null {
    const path = this.paths().ledger;
    if (!existsSync(path)) return null;
    return validateLedger(JSON.parse(readFileSync(path, "utf8")));
  }
}
