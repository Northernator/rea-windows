import { describe, expect, it } from "vitest";

import { observeNativeUiWindows } from "./NativeUiObservationWindows.js";
import type { NativeUiHelper } from "./NativeUiHelperRuntimeWindows.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";

const target: BinaryTarget = {
  kind: "executable",
  format: "pe",
  path: "C:\\app\\App.exe",
  sha256: "a".repeat(64),
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
  executableRole: "application",
  managed: false,
};

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
  target_sha256: target.sha256,
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

const helperReturning =
  (value: unknown): NativeUiHelper =>
  async () =>
    value;

describe("observeNativeUiWindows", () => {
  it("returns a passive snapshot as an observation result", async () => {
    const result = await observeNativeUiWindows(
      target,
      "observe_native_ui",
      baseParameters,
      {
        invoke: helperReturning({ ok: true, result: snapshot }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.initial).toEqual(snapshot);
    expect(result.value.steps).toEqual([]);
    expect(result.value.target_sha256).toBe(target.sha256);
  });

  it("surfaces helper failures as capability errors", async () => {
    const result = await observeNativeUiWindows(
      target,
      "observe_native_ui",
      baseParameters,
      {
        invoke: helperReturning({
          ok: false,
          code: "target_unavailable",
          message: "no window for handle 99",
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("target_unavailable");
  });

  it("rejects malformed helper envelopes", async () => {
    const result = await observeNativeUiWindows(
      target,
      "observe_native_ui",
      baseParameters,
      {
        invoke: helperReturning({
          ok: true,
          result: { window: "not-a-window" },
        }),
      },
    );
    expect(result.ok).toBe(false);
  });

  it("passes scenario steps through and returns the result envelope", async () => {
    let seen: Record<string, unknown> | undefined;
    const invoke: NativeUiHelper = async (parameters) => {
      seen = parameters as Record<string, unknown>;
      return { ok: true, result: scenarioResult };
    };
    const result = await observeNativeUiWindows(
      target,
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
    expect(seen).toMatchObject({
      executable: target.path,
      sha256: target.sha256,
    });
  });

  it("fails closed when neither screenshot nor accessibility is enabled", async () => {
    const result = await observeNativeUiWindows(
      target,
      "observe_native_ui",
      {
        ...baseParameters,
        screenshot: false,
        accessibility: false,
      },
      {
        invoke: helperReturning({ ok: true, result: snapshot }),
      },
    );
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
      target,
      "capture_native_ui_scenario",
      { ...baseParameters, steps: [{ kind: "teleport", path: [0] }] },
      { invoke },
    );
    expect(result.ok).toBe(false);
    expect(invoked).toBe(false);
  });

  it.each([
    { pid: 999 },
    { window_id: 999 },
    { executable: "C:\\other.exe" },
    { launch_time: 0 },
  ])("rejects a passive snapshot from another target: %j", async (change) => {
    const result = await observeNativeUiWindows(
      target,
      "observe_native_ui",
      baseParameters,
      {
        invoke: helperReturning({
          ok: true,
          result: { ...snapshot, window: { ...snapshot.window, ...change } },
        }),
      },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects process reuse during a scenario", async () => {
    const result = await observeNativeUiWindows(
      target,
      "capture_native_ui_scenario",
      {
        ...baseParameters,
        steps: [{ kind: "click", path: [0] }],
      },
      {
        invoke: helperReturning({
          ok: true,
          result: {
            ...scenarioResult,
            steps: [
              {
                ...scenarioResult.steps[0],
                after: {
                  ...snapshot,
                  window: { ...snapshot.window, launch_time: 2 },
                },
              },
            ],
          },
        }),
      },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects fabricated scenario target digests", async () => {
    const result = await observeNativeUiWindows(
      target,
      "capture_native_ui_scenario",
      {
        ...baseParameters,
        steps: [{ kind: "click", path: [0] }],
      },
      {
        invoke: helperReturning({
          ok: true,
          result: { ...scenarioResult, target_sha256: "wrong" },
        }),
      },
    );
    expect(result.ok).toBe(false);
  });

  it("does not invoke a helper after passive cancellation", async () => {
    let invoked = false;
    const controller = new AbortController();
    controller.abort("stop");
    const result = await observeNativeUiWindows(
      target,
      "observe_native_ui",
      baseParameters,
      {
        signal: controller.signal,
        invoke: async () => {
          invoked = true;
          return {};
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(invoked).toBe(false);
  });
});
