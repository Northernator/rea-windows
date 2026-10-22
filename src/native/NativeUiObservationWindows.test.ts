import { describe, expect, it } from "vitest";

import { observeNativeUiWindows } from "./NativeUiObservationWindows.js";
import type { NativeUiHelper } from "./NativeUiHelperRuntimeWindows.js";

const baseParameters = {
  pid: 4242,
  window_id: 99,
  screenshot: false,
  accessibility: true,
  max_nodes: 10,
};

const snapshot = {
  window: {
    pid: 4242,
    window_id: 99,
    executable: "C:\\app\\App.exe",
    launch_time: 1,
    title: "App",
  },
  nodes: [
    {
      path: [0],
      role: "ButtonControl",
      title: "OK",
      value: null,
      actions: ["invoke"],
      children_count: 0,
    },
  ],
  truncated: false,
  screenshot: null,
  gaps: [],
};

const scenarioResult = {
  target_sha256: "C:\\app\\App.exe",
  initial: snapshot,
  steps: [
    {
      index: 0,
      kind: "click",
      before: snapshot,
      after: snapshot,
      outcome: "completed",
      reason: null,
    },
  ],
  restore: "leave-as-is",
  limitations: ["Windows UIA exposes control patterns"],
};

const helperReturning = (value: unknown): NativeUiHelper => async () => value;

describe("observeNativeUiWindows", () => {
  it("returns a passive snapshot as an observation result", async () => {
    const result = await observeNativeUiWindows("observe_native_ui", baseParameters, {
      invoke: helperReturning({ ok: true, result: snapshot }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.initial).toEqual(snapshot);
    expect(result.value.steps).toEqual([]);
    expect(result.value.target_sha256).toBe("C:\\app\\App.exe");
  });

  it("surfaces helper failures as capability errors", async () => {
    const result = await observeNativeUiWindows("observe_native_ui", baseParameters, {
      invoke: helperReturning({
        ok: false,
        code: "target_unavailable",
        message: "no window for handle 99",
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("target_unavailable");
  });

  it("rejects malformed helper envelopes", async () => {
    const result = await observeNativeUiWindows("observe_native_ui", baseParameters, {
      invoke: helperReturning({ ok: true, result: { window: "not-a-window" } }),
    });
    expect(result.ok).toBe(false);
  });

  it("passes scenario steps through and returns the result envelope", async () => {
    let seen: Record<string, unknown> | undefined;
    const invoke: NativeUiHelper = async (parameters) => {
      seen = parameters as Record<string, unknown>;
      return { ok: true, result: scenarioResult };
    };
    const result = await observeNativeUiWindows(
      "capture_native_ui_scenario",
      {
        ...baseParameters,
        steps: [{ kind: "click", path: [0] }],
      },
      { invoke },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.steps).toHaveLength(1);
    expect(seen?.steps).toEqual([{ kind: "click", path: [0] }]);
  });

  it("fails closed when neither screenshot nor accessibility is enabled", async () => {
    const result = await observeNativeUiWindows("observe_native_ui", {
      ...baseParameters,
      screenshot: false,
      accessibility: false,
    }, {
      invoke: helperReturning({ ok: true, result: snapshot }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("AnalysisInputError");
  });

  it("rejects unknown step kinds before invoking the helper", async () => {
    let invoked = false;
    const invoke: NativeUiHelper = async () => {
      invoked = true;
      return { ok: true, result: snapshot };
    };
    const result = await observeNativeUiWindows(
      "capture_native_ui_scenario",
      { ...baseParameters, steps: [{ kind: "teleport", path: [0] }] },
      { invoke },
    );
    expect(result.ok).toBe(false);
    expect(invoked).toBe(false);
  });
});
