import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFileOutput } from "../process/ExecFileOutput.js";
import {
  createWindowsUiHelper,
  findWindowsHelperPython,
} from "./NativeUiHelperRuntimeWindows.js";

vi.mock("../process/ExecFileOutput.js", async (original) => ({
  ...(await original<typeof import("../process/ExecFileOutput.js")>()),
  execFileOutput: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

describe("Windows helper runtime", () => {
  it("probes with the selected environment and deduplicates candidates", async () => {
    vi.mocked(execFileOutput).mockRejectedValue(new Error("not installed"));
    await expect(
      findWindowsHelperPython({
        REA_WINDOWS_PYTHON: "python",
        PYTHON: "python",
        PATH: "chosen",
      }),
    ).resolves.toBeUndefined();
    expect(
      vi.mocked(execFileOutput).mock.calls.map(([command]) => command),
    ).toEqual(["python", "python3", "py"]);
    expect(execFileOutput).toHaveBeenCalledWith(
      "python",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ PATH: "chosen", PYTHONUTF8: "1" }),
        stopSignal: "SIGTERM",
      }),
    );
  });

  it("stops interpreter discovery when cancelled", async () => {
    const controller = new AbortController();
    vi.mocked(execFileOutput).mockImplementation(async () => {
      controller.abort("cancel probe");
      throw new Error("aborted");
    });
    await expect(
      findWindowsHelperPython({}, 1000, controller.signal),
    ).rejects.toMatchObject({
      code: "ABORT_ERR",
    });
    expect(execFileOutput).toHaveBeenCalledTimes(1);
  });

  it("writes Unicode parameters, keeps the environment and removes its temporary directory", async () => {
    let parametersPath = "";
    vi.mocked(execFileOutput).mockImplementation(async (_command, args) => {
      parametersPath = args[1]!;
      expect(JSON.parse(await readFile(parametersPath, "utf8"))).toEqual({
        text: "hello £ 😀",
      });
      return {
        stdout: '{"ok":true}',
        stderr: "",
        stdoutBytes: 11,
        stderrBytes: 0,
      };
    });
    const helper = createWindowsUiHelper("chosen-python", 5000, {
      PATH: "chosen",
      SYSTEMROOT: "windows",
    });
    await expect(helper({ text: "hello £ 😀" })).resolves.toEqual({ ok: true });
    expect(execFileOutput).toHaveBeenCalledWith(
      "chosen-python",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: "chosen",
          SYSTEMROOT: "windows",
          PYTHONIOENCODING: "utf-8",
        }),
        timeout: 5000,
        stopSignal: "SIGTERM",
      }),
    );
    await expect(readdir(dirname(parametersPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes temporary parameters after helper failure", async () => {
    let parametersPath = "";
    vi.mocked(execFileOutput).mockImplementation(async (_command, args) => {
      parametersPath = args[1]!;
      throw new Error("helper failed");
    });
    await expect(createWindowsUiHelper("python")({})).rejects.toThrow(
      "helper failed",
    );
    await expect(readdir(dirname(parametersPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
