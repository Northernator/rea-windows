import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisClientContext,
  type AnalysisExecution,
} from "../application/AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  DEFAULT_NATIVE_UI_DEADLINE_MS,
  MAX_NATIVE_TIMER_MS,
  readNativeDeadline,
} from "../domain/native/nativeDeadlines.js";
import {
  NATIVE_WINDOWS_PROVIDER_IDENTITY,
  nativeWindowsCapabilities,
} from "./NativeWindowsProviderMetadata.js";
import {
  createWindowsUiHelper,
  findWindowsHelperPython,
} from "./NativeUiHelperRuntimeWindows.js";
import { observeNativeUiWindows } from "./NativeUiObservationWindows.js";

/** Operations this provider accepts. */
type WindowsUiOperation = "health" | "observe_native_ui" | "capture_native_ui_scenario";

/**
 * Windows UI Automation provider.
 *
 * Observes and drives already-running application windows. The Python helper
 * interpreter is probed once per client; a missing interpreter or package
 * fails the operation with the probe reason rather than claiming support.
 */
export class NativeWindowsProvider {
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  #probe: Promise<string | undefined> | undefined;
  #closed = false;

  constructor(environment: Readonly<NodeJS.ProcessEnv>) {
    this.#environment = environment;
  }

  identity() {
    return NATIVE_WINDOWS_PROVIDER_IDENTITY;
  }

  capabilities() {
    return nativeWindowsCapabilities();
  }

  /**
   * Bind one target. The window handle arrives per call, so the client is the
   * provider itself; the target is recorded for evidence locations only.
   */
  createClient(
    target: BinaryTarget,
    _profile?: unknown,
    _context?: AnalysisClientContext,
  ): AnalysisClient {
    return new NativeWindowsClient(this, target);
  }

  async execute(
    operation: WindowsUiOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Result<unknown, AnalysisError>> {
    if (this.#closed)
      return err(
        new AnalysisCapabilityUnavailableError(
          NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
          operation,
          "Windows UI provider client is closed",
        ),
      );
    if (operation === "health")
      return ok(createAnalysisExecution(null, NATIVE_WINDOWS_PROVIDER_IDENTITY));
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError(operation, { cause: options.signal.reason }),
      );

    const deadline = readNativeDeadline(
      parameters.native_ui_deadline_ms,
      DEFAULT_NATIVE_UI_DEADLINE_MS,
    );
    if (!deadline.ok)
      return err(
        new AnalysisInputError(operation, { userMessage: deadline.message }, [
          {
            path: ["native_ui_deadline_ms"],
            reason: deadline.reason,
            message: deadline.message,
            minimum: 1,
            maximum: MAX_NATIVE_TIMER_MS,
          },
        ]),
      );

    // Cheap input checks before probing the host environment.
    if (parameters.screenshot === false && parameters.accessibility === false)
      return err(
        new AnalysisInputError(operation, {
          cause: new Error("Enable screenshot or accessibility capture"),
        }),
      );

    this.#probe ??= findWindowsHelperPython(this.#environment);
    const python = await this.#probe;
    if (python === undefined)
      return err(
        new AnalysisCapabilityUnavailableError(
          NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
          operation,
          "No Python interpreter with uiautomation and Pillow importable. Install them and set REA_WINDOWS_PYTHON or add python to PATH.",
        ),
      );

    const observation = await observeNativeUiWindows(operation, parameters, {
      invoke: createWindowsUiHelper(
        python,
        Math.min(deadline.timeoutMs, MAX_NATIVE_TIMER_MS),
      ),
      signal: options?.signal,
    });
    return observation.ok
      ? ok(
          createAnalysisExecution(
            observation.value,
            NATIVE_WINDOWS_PROVIDER_IDENTITY,
            { limitations: observation.value.limitations },
          ),
        )
      : observation;
  }

  async close(): Promise<Result<null, AnalysisError>> {
    this.#closed = true;
    return ok(null);
  }
}

/** Client bound to one target; delegates to the provider's operations. */
class NativeWindowsClient implements AnalysisClient {
  readonly #provider: NativeWindowsProvider;

  constructor(provider: NativeWindowsProvider, _target: BinaryTarget) {
    this.#provider = provider;
  }

  execute(
    operation: string,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (
      operation !== "health" &&
      operation !== "observe_native_ui" &&
      operation !== "capture_native_ui_scenario"
    )
      return Promise.resolve(
        err(
          new AnalysisCapabilityUnavailableError(
            NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
            operation,
            "Windows UI provider handles health, observe_native_ui and capture_native_ui_scenario only",
          ),
        ),
      );
    return this.#provider.execute(
      operation as WindowsUiOperation,
      parameters,
      options,
    ) as Promise<Result<AnalysisExecution, AnalysisError>>;
  }

  close(): Promise<Result<null, AnalysisError>> {
    return this.#provider.close();
  }
}
