import { describe, expect, it } from "vitest";

import { NativeWindowsProvider } from "./NativeWindowsProvider.js";
import {
  NATIVE_WINDOWS_PROVIDER_IDENTITY,
  nativeWindowsCapabilities,
} from "./NativeWindowsProviderMetadata.js";

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

describe("nativeWindowsCapabilities", () => {
  it("claims both UI operations only on Windows", () => {
    const windows = nativeWindowsCapabilities("win32");
    expect(windows.map((capability) => capability.operation)).toEqual([
      "observe_native_ui",
      "capture_native_ui_scenario",
    ]);
    expect(windows.every((capability) => capability.available)).toBe(true);

    const linux = nativeWindowsCapabilities("linux");
    expect(linux.every((capability) => !capability.available)).toBe(true);
    expect(linux[0]?.reason).toContain("Windows");
  });

  it("marks scenario capture as UI-driving", () => {
    const windows = nativeWindowsCapabilities("win32");
    const scenario = windows.find(
      (capability) => capability.operation === "capture_native_ui_scenario",
    );
    expect(scenario?.effects.mayShowUi).toBe(true);
    const observe = windows.find(
      (capability) => capability.operation === "observe_native_ui",
    );
    expect(observe?.effects.mutatesArtifact).toBe(false);
  });
});

describe("NativeWindowsProvider", () => {
  it("answers health without a helper", async () => {
    const provider = new NativeWindowsProvider({});
    const result = await provider.execute("health", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      provider: NATIVE_WINDOWS_PROVIDER_IDENTITY,
    });
    expect(provider.identity()).toEqual(NATIVE_WINDOWS_PROVIDER_IDENTITY);
  });

  it("reports a missing helper interpreter instead of claiming support", async () => {
    const provider = new NativeWindowsProvider({
      // point every candidate at a binary that cannot import the helper deps
      REA_WINDOWS_PYTHON: "definitely-not-python-xyz",
      PYTHON: "definitely-not-python-xyz",
      PATH: "",
    });
    const result = await provider.execute("observe_native_ui", baseParameters);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("No Python interpreter");
  });

  it("closes and refuses further work", async () => {
    const provider = new NativeWindowsProvider({});
    await provider.close();
    const result = await provider.execute("observe_native_ui", baseParameters);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("closed");
  });

  it("rejects an invalid deadline before probing", async () => {
    const provider = new NativeWindowsProvider({});
    const result = await provider.execute("observe_native_ui", {
      ...baseParameters,
      native_ui_deadline_ms: -5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("native_ui_deadline_ms");
  });

  it("requires screenshot or accessibility", async () => {
    const provider = new NativeWindowsProvider({});
    const result = await provider.execute("observe_native_ui", {
      ...baseParameters,
      screenshot: false,
      accessibility: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("AnalysisInputError");
  });
});
