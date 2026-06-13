import { describe, expect, it } from "vitest";
import { BreakerEngine, initialBreakerState } from "../src/circuit-breakers.js";
import { defaultConfig } from "./test-helpers.js";

describe("circuit-breakers — 5 breakers", () => {
  it("max_review_rounds: trips after threshold", () => {
    const cfg = defaultConfig();
    const engine = new BreakerEngine(cfg);
    const state = initialBreakerState();
    expect(engine.bumpRound(state, "design")).toBeNull();
    expect(engine.bumpRound(state, "design")).toBeNull();
    expect(engine.bumpRound(state, "design")).toBeNull();
    const trip = engine.bumpRound(state, "design");
    expect(trip?.name).toBe("max_review_rounds");
  });

  it("scope_drift: trips when cumulative diff > threshold", () => {
    const cfg = defaultConfig();
    const engine = new BreakerEngine(cfg);
    const state = initialBreakerState();
    expect(engine.recordScopeDrift(state, 100)).toBeNull();
    expect(engine.recordScopeDrift(state, 100)).toBeNull();
    const trip = engine.recordScopeDrift(state, 1);
    expect(trip?.name).toBe("scope_drift");
  });

  it("codex_unavailable: trips after streak", () => {
    const cfg = defaultConfig();
    const engine = new BreakerEngine(cfg);
    const state = initialBreakerState();
    expect(engine.recordCodexFailure(state)).toBeNull();
    expect(engine.recordCodexFailure(state)).toBeNull();
    const trip = engine.recordCodexFailure(state);
    expect(trip?.name).toBe("codex_unavailable");
  });

  it("recordCodexSuccess resets streak", () => {
    const cfg = defaultConfig();
    const engine = new BreakerEngine(cfg);
    const state = initialBreakerState();
    engine.recordCodexFailure(state);
    engine.recordCodexFailure(state);
    engine.recordCodexSuccess(state);
    // After reset, two more failures should not yet trip.
    expect(engine.recordCodexFailure(state)).toBeNull();
    expect(engine.recordCodexFailure(state)).toBeNull();
  });

  it("parser_unavailable: trips after streak", () => {
    const cfg = defaultConfig();
    const engine = new BreakerEngine(cfg);
    const state = initialBreakerState();
    expect(engine.recordParserFailure(state)).toBeNull();
    expect(engine.recordParserFailure(state)).toBeNull();
    const trip = engine.recordParserFailure(state);
    expect(trip?.name).toBe("parser_unavailable");
  });

  it("triggerContextExhausted always returns the breaker", () => {
    const cfg = defaultConfig();
    const engine = new BreakerEngine(cfg);
    const state = initialBreakerState();
    const trip = engine.triggerContextExhausted(state);
    expect(trip.name).toBe("context_exhausted");
    expect(state.context_exhausted_triggered).toBe(true);
  });
});

describe("circuit-breakers — Round 3 三阈值仅可收紧", () => {
  it("constructor accepts shrunk values", () => {
    const cfg = defaultConfig({
      circuit_breakers: {
        ...defaultConfig().circuit_breakers,
        design_mechanical_max_sections: 4, // shrunk from 8
        code_mechanical_max_fix_lines: 50, // shrunk from 100
        code_mechanical_max_modules: 1,
      },
    });
    expect(() => new BreakerEngine(cfg)).not.toThrow();
  });

  it("constructor rejects relaxed sections (9 > 8)", () => {
    const cfg = defaultConfig({
      circuit_breakers: {
        ...defaultConfig().circuit_breakers,
        design_mechanical_max_sections: 9,
      },
    });
    expect(() => new BreakerEngine(cfg)).toThrow(/may only be shrunk/);
  });

  it("constructor rejects relaxed fix-lines (101 > 100)", () => {
    const cfg = defaultConfig({
      circuit_breakers: {
        ...defaultConfig().circuit_breakers,
        code_mechanical_max_fix_lines: 101,
      },
    });
    expect(() => new BreakerEngine(cfg)).toThrow(/may only be shrunk/);
  });

  it("constructor rejects relaxed modules (2 > 1)", () => {
    const cfg = defaultConfig({
      circuit_breakers: {
        ...defaultConfig().circuit_breakers,
        code_mechanical_max_modules: 2,
      },
    });
    expect(() => new BreakerEngine(cfg)).toThrow(/may only be shrunk/);
  });

  it("boundary: equal values are accepted", () => {
    const cfg = defaultConfig();
    expect(() => new BreakerEngine(cfg)).not.toThrow();
  });
});
