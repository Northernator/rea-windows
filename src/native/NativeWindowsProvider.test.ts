import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  createWindowsUiHelper,
  findWindowsHelperPython,
} from "./NativeUiHelperRuntimeWindows.js";

vi.mock("./NativeUiHelperRuntimeWindows.js", () => ({
  findWindowsHelperPython: vi.fn(),
  createWindowsUiHelper: vi.fn(),
}));

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

beforeEach(() => vi.resetAllMocks());

import { NativeWindowsProvider } from "./NativeWindowsProvider.js";
import { nativeMacOSCapabilities } from "./NativeMacOSProviderMetadata.js";
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
    expect(linux).toEqual([]);
    expect(nativeWindowsCapabilities("darwin")).toEqual([]);
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

  it.each(["win32", "darwin", "linux"] as const)(
    "keeps UI declarations disjoint on %s",
    (platform) => {
      const windows = nativeWindowsCapabilities(platform);
      const macos = nativeMacOSCapabilities(platform);
      const macosOperations = new Set(macos.map(({ operation }) => operation));
      expect(
        windows.some(({ operation }) => macosOperations.has(operation)),
      ).toBe(false);
      expect(macosOperations.has("inspect_native_dispatch_metadata")).toBe(
        true,
      );
    },
  );
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
    const result = await provider
      .createClient(target)
      .execute("observe_native_ui", baseParameters);
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

  it("keeps another target client usable when one closes", async () => {
    const provider = new NativeWindowsProvider({});
    const first = provider.createClient(target);
    const second = provider.createClient(target);
    await first.close();
    expect((await second.execute("health", {})).ok).toBe(true);
    expect((await first.execute("health", {})).ok).toBe(false);
  });

  it("binds the selected target and keeps the caller environment", async () => {
    vi.mocked(findWindowsHelperPython).mockResolvedValue("python");
    vi.mocked(createWindowsUiHelper).mockReturnValue(async () => ({
      ok: true,
      result: snapshot,
    }));
    const provider = new NativeWindowsProvider({
      PATH: "selected-path",
      SYSTEMROOT: "selected-root",
    });
    const result = await provider
      .createClient(target)
      .execute("observe_native_ui", baseParameters);
    expect(result.ok).toBe(true);
    expect(findWindowsHelperPython).toHaveBeenCalledWith(
      expect.objectContaining({ PATH: "selected-path" }),
      expect.any(Number),
      expect.any(AbortSignal),
    );
    expect(createWindowsUiHelper).toHaveBeenCalledWith(
      "python",
      expect.any(Number),
      expect.objectContaining({ SYSTEMROOT: "selected-root" }),
    );
  });

  it("cancels and waits for its running helper when closed", async () => {
    vi.mocked(findWindowsHelperPython).mockResolvedValue("python");
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(createWindowsUiHelper).mockReturnValue(
      async (_parameters, signal) => {
        started();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("stopped")),
            { once: true },
          );
        });
      },
    );
    const client = new NativeWindowsProvider({}).createClient(target);
    const pending = client.execute("observe_native_ui", baseParameters);
    await ready;
    await client.close();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
  });

  it("applies the UI deadline to interpreter probing", async () => {
    vi.mocked(findWindowsHelperPython).mockImplementation(
      async (_environment, _timeout, signal) => {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("stopped")),
            { once: true },
          );
        });
      },
    );
    const result = await new NativeWindowsProvider({})
      .createClient(target)
      .execute("observe_native_ui", {
        ...baseParameters,
        native_ui_deadline_ms: 5,
      });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisTimeoutError");
    expect(createWindowsUiHelper).not.toHaveBeenCalled();
  });

  it("retains a validated capture when cancellation reaches finalization", async () => {
    vi.mocked(findWindowsHelperPython).mockResolvedValue("python");
    const controller = new AbortController();
    vi.mocked(createWindowsUiHelper).mockReturnValue(async () => {
      controller.abort("cancel after capture");
      return { ok: true, result: snapshot };
    });
    const result = await new NativeWindowsProvider({})
      .createClient(target)
      .execute("observe_native_ui", baseParameters, {
        signal: controller.signal,
      });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(result.error.partialObservation).toMatchObject({
      target_sha256: target.sha256,
      initial: snapshot,
    });
  });
});
