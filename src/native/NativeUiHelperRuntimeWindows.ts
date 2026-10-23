import {
  execFileOutput,
  ExecFileOutputCancelledError,
} from "../process/ExecFileOutput.js";
import { safeParseJson } from "../domain/safeJson.js";
import { DEFAULT_NATIVE_UI_DEADLINE_MS } from "../domain/native/nativeDeadlines.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Python helper that drives Windows UI Automation. */
const HELPER_SCRIPT = fileURLToPath(
  new URL("../../bridge/native/rea_native_ui_windows.py", import.meta.url),
);

/** One helper invocation: parameters in, one JSON envelope out. */
export type NativeUiHelper = (
  parameters: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
) => Promise<unknown>;

/** One helper invocation: parameters in a temp file, one JSON envelope out. */
const invokeWindowsHelper = async (
  python: string,
  parameters: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): Promise<unknown> => {
  const root = await mkdtemp(join(tmpdir(), "rea-native-ui-win-"));
  const paramsPath = join(root, "parameters.json");
  try {
    await writeFile(paramsPath, JSON.stringify(parameters), "utf-8");
    const output = await execFileOutput(python, [HELPER_SCRIPT, paramsPath], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...environment, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      signal,
      stopSignal: "SIGTERM",
    });
    const stdout = output.stdout.trim();
    const parsed = safeParseJson(stdout);
    if (!parsed.ok) {
      throw new Error(
        `Windows UI helper returned non-JSON output: ${stdout.slice(0, 200)}`,
      );
    }
    return parsed.value;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

/**
 * Locate a Python interpreter that can import the helper's dependencies.
 *
 * execFileOutput rejects on a non-zero exit, so a candidate that cannot
 * import uiautomation/Pillow simply throws and the next one is tried.
 */
export const findWindowsHelperPython = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  timeoutMs: number = 10_000,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  const candidates = [
    environment.REA_WINDOWS_PYTHON,
    environment.HARNESS_FORGE_PYTHON,
    environment.PYTHON,
    "python",
    "python3",
    "py",
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  for (const candidate of new Set(candidates)) {
    if (signal?.aborted) throw new ExecFileOutputCancelledError(signal.reason);
    try {
      await execFileOutput(candidate, ["-c", "import uiautomation, PIL"], {
        timeout: timeoutMs,
        maxBuffer: 4096,
        env: { ...environment, PYTHONUTF8: "1" },
        signal,
        stopSignal: "SIGTERM",
      });
      return candidate;
    } catch {
      if (signal?.aborted)
        throw new ExecFileOutputCancelledError(signal.reason);
      // try the next candidate
    }
  }
  return undefined;
};

/** Create a helper invocation bound to one Python interpreter. */
export const createWindowsUiHelper = (
  python: string,
  timeoutMs: number = DEFAULT_NATIVE_UI_DEADLINE_MS,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): NativeUiHelper => {
  return (parameters, signal) =>
    invokeWindowsHelper(python, parameters, timeoutMs, signal, environment);
};
