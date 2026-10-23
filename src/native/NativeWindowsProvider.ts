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
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { AnalysisPartialObservation } from "../domain/analysisErrorBase.js";
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
import { ProviderStartupDeadline } from "../process/ProviderDeadline.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";

/** Operations this provider accepts. */
type WindowsUiOperation =
  | "health"
  | "observe_native_ui"
  | "capture_native_ui_scenario";

/**
 * Windows UI Automation provider.
 *
 * Observes and drives already-running application windows. The Python helper
 * interpreter is cached after a successful probe; a missing interpreter or
 * package fails the operation and can be retried after the host is repaired.
 */
export class NativeWindowsProvider {
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  #python: string | undefined;
  #closed = false;

  constructor(environment: Readonly<NodeJS.ProcessEnv>) {
    this.#environment = snapshotEnvironment(environment);
  }

  identity() {
    return NATIVE_WINDOWS_PROVIDER_IDENTITY;
  }

  capabilities() {
    return nativeWindowsCapabilities();
  }

  /**
   * Bind one executable target. Each request must identify a window belonging
   * to that executable; clients own their cancellation and close lifecycle.
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
    target?: BinaryTarget,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (this.#closed)
      return err(
        new AnalysisCapabilityUnavailableError(
          NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
          operation,
          "Windows UI provider client is closed",
        ),
      );
    if (operation === "health")
      return ok(
        createAnalysisExecution(null, NATIVE_WINDOWS_PROVIDER_IDENTITY),
      );
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

    if (target === undefined)
      return err(
        new AnalysisInputError(operation, {
          cause: new Error(
            "Windows UI operations require a client bound to an executable target",
          ),
        }),
      );

    // The caller's deadline covers interpreter discovery as well as capture.
    const control = new ProviderStartupDeadline(
      deadline.timeoutMs,
      options?.signal,
    );
    const interrupted = (
      partialObservation?: AnalysisPartialObservation,
    ): AnalysisError | undefined =>
      control.interruption === "cancelled"
        ? new AnalysisCancelledError(operation, {
            cause: options?.signal?.reason,
            partialObservation,
          })
        : control.interruption === "timeout"
          ? new AnalysisTimeoutError(operation, deadline.timeoutMs, {
              partialObservation,
            })
          : undefined;
    try {
      const python =
        this.#python ??
        (await findWindowsHelperPython(
          this.#environment,
          Math.min(10_000, control.remainingMs()),
          control.signal,
        ));
      const interruption = interrupted();
      if (interruption !== undefined) return err(interruption);
      if (python === undefined)
        return err(
          new AnalysisCapabilityUnavailableError(
            NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
            operation,
            "No Python interpreter with uiautomation and Pillow importable. Install them and set REA_WINDOWS_PYTHON or add python to PATH.",
          ),
        );
      this.#python = python;
      const observation = await observeNativeUiWindows(
        target,
        operation,
        parameters,
        {
          invoke: createWindowsUiHelper(
            python,
            Math.max(1, control.remainingMs()),
            this.#environment,
          ),
          signal: control.signal,
        },
      );
      const after = interrupted(
        observation.ok
          ? observation.value
          : observation.error.partialObservation,
      );
      if (after !== undefined) return err(after);
      return observation.ok
        ? ok(
            createAnalysisExecution(
              observation.value,
              NATIVE_WINDOWS_PROVIDER_IDENTITY,
              {
                limitations: observation.value.limitations,
              },
            ),
          )
        : observation;
    } catch (cause: unknown) {
      return err(
        interrupted() ??
          new ProviderAdapterError(
            NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
            operation,
            { cause },
          ),
      );
    } finally {
      control.dispose();
    }
  }

  async close(): Promise<Result<null, AnalysisError>> {
    this.#closed = true;
    return ok(null);
  }
}

/** Client bound to one target; delegates to the provider's operations. */
class NativeWindowsClient implements AnalysisClient {
  readonly #provider: NativeWindowsProvider;
  readonly #target: BinaryTarget;
  readonly #closing = new AbortController();
  readonly #pending = new Set<
    Promise<Result<AnalysisExecution, AnalysisError>>
  >();
  #tail: Promise<unknown> = Promise.resolve();

  constructor(provider: NativeWindowsProvider, target: BinaryTarget) {
    this.#provider = provider;
    this.#target = target;
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
    if (this.#closing.signal.aborted)
      return Promise.resolve(
        err(
          new AnalysisCapabilityUnavailableError(
            NATIVE_WINDOWS_PROVIDER_IDENTITY.id,
            operation,
            "Windows UI provider client is closed",
          ),
        ),
      );
    const signal =
      options?.signal === undefined
        ? this.#closing.signal
        : AbortSignal.any([options.signal, this.#closing.signal]);
    const pending = this.#tail.then(() =>
      this.#provider.execute(operation, parameters, { signal }, this.#target),
    );
    this.#tail = pending;
    this.#pending.add(pending);
    void pending.finally(() => this.#pending.delete(pending));
    return pending;
  }

  async close(): Promise<Result<null, AnalysisError>> {
    this.#closing.abort(new Error("Windows UI provider client is closed"));
    await Promise.allSettled(this.#pending);
    return ok(null);
  }
}
