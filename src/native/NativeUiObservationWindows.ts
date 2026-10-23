import { z } from "zod";
import { win32 } from "node:path";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";

import {
  nativeUiObservationInputSchema,
  nativeUiScenarioInputSchema,
  nativeUiSnapshotSchema,
  nativeUiResultSchema,
} from "../domain/native/nativeUiObservation.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import type { NativeUiHelper } from "./NativeUiHelperRuntimeWindows.js";

const snapshotResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), result: nativeUiSnapshotSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);

const scenarioResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), result: nativeUiResultSchema }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);

/** Provider id committed to Windows UIA observations. */
export const NATIVE_WINDOWS_PROVIDER_ID = "native-windows";

/**
 * Observe one already-running Windows window, or run an explicit scenario.
 *
 * The selected PE executable, process and window must agree before the helper
 * can act. The first snapshot binds launch time; later captures that disagree
 * report a target change rather than an observation.
 */
export const observeNativeUiWindows = async (
  target: BinaryTarget,
  operation: "observe_native_ui" | "capture_native_ui_scenario",
  parameters: unknown,
  options: {
    invoke: NativeUiHelper;
    signal?: AbortSignal | undefined;
  },
): Promise<Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>> => {
  const parsed = (
    operation === "observe_native_ui" ? passiveInputSchema : scenarioInputSchema
  ).safeParse(parameters);
  if (!parsed.success)
    return err(new AnalysisInputError(operation, { cause: parsed.error }));

  if (target.kind !== "executable" || target.format !== "pe")
    return err(
      new AnalysisCapabilityUnavailableError(
        NATIVE_WINDOWS_PROVIDER_ID,
        operation,
        "Windows UI observation requires an active PE executable target",
      ),
    );

  const input = parsed.data;
  if (!input.screenshot && !input.accessibility)
    return err(
      new AnalysisInputError(operation, {
        cause: new Error("Enable screenshot or accessibility capture"),
      }),
    );

  const adapterFailure = (cause: unknown): AnalysisError =>
    options.signal?.aborted
      ? new AnalysisCancelledError(operation, { cause: options.signal.reason })
      : cause instanceof AnalysisError
        ? cause
        : new ProviderAdapterError(NATIVE_WINDOWS_PROVIDER_ID, operation, {
            cause,
          });

  if (options.signal?.aborted)
    return err(
      new AnalysisCancelledError(operation, { cause: options.signal.reason }),
    );

  const samePath = (left: string, right: string): boolean =>
    win32.normalize(left).toLowerCase() ===
    win32.normalize(right).toLowerCase();
  const matchesTarget = (
    snapshot: z.infer<typeof nativeUiSnapshotSchema>,
    launchTime?: number,
  ): boolean =>
    snapshot.window.pid === input.pid &&
    snapshot.window.window_id === input.window_id &&
    samePath(snapshot.window.executable, target.path) &&
    snapshot.window.launch_time > 0 &&
    (launchTime === undefined || snapshot.window.launch_time === launchTime);
  const wrongTarget = (): Result<never, AnalysisError> =>
    err(
      new AnalysisCapabilityUnavailableError(
        NATIVE_WINDOWS_PROVIDER_ID,
        operation,
        "Windows UI helper returned a different target process, executable or window",
      ),
    );
  const helperParameters = {
    pid: input.pid,
    window_id: input.window_id,
    executable: target.path,
    sha256: target.sha256,
    screenshot: input.screenshot,
    accessibility: input.accessibility,
    max_nodes: input.max_nodes,
    native_ui_deadline_ms: input.native_ui_deadline_ms,
  };

  if (operation === "observe_native_ui") {
    let response: unknown;
    try {
      response = await options.invoke(helperParameters, options.signal);
    } catch (cause: unknown) {
      return err(adapterFailure(cause));
    }
    const parsedResponse = snapshotResponseSchema.safeParse(response);
    if (!parsedResponse.success)
      return err(adapterFailure(parsedResponse.error));
    if (!parsedResponse.data.ok)
      return err(
        new AnalysisCapabilityUnavailableError(
          NATIVE_WINDOWS_PROVIDER_ID,
          operation,
          `${parsedResponse.data.code}: ${parsedResponse.data.message}`,
        ),
      );
    const snapshot = parsedResponse.data.result;
    if (!matchesTarget(snapshot)) return wrongTarget();
    return ok({
      target_sha256: target.sha256,
      initial: snapshot,
      steps: [],
      restore: "leave-as-is" as const,
      limitations: snapshot.gaps.map((gap) => `snapshot gap: ${gap}`),
    });
  }

  if (options.signal?.aborted)
    return err(new AnalysisCancelledError(operation));

  let response: unknown;
  try {
    response = await options.invoke(
      {
        ...helperParameters,
        steps: input.steps,
      },
      options.signal,
    );
  } catch (cause: unknown) {
    return err(adapterFailure(cause));
  }
  const parsedResponse = scenarioResponseSchema.safeParse(response);
  if (!parsedResponse.success) return err(adapterFailure(parsedResponse.error));
  if (!parsedResponse.data.ok)
    return err(
      new AnalysisCapabilityUnavailableError(
        NATIVE_WINDOWS_PROVIDER_ID,
        operation,
        `${parsedResponse.data.code}: ${parsedResponse.data.message}`,
      ),
    );
  const result = parsedResponse.data.result;
  const launchTime = result.initial.window.launch_time;
  if (result.target_sha256 !== target.sha256 || !matchesTarget(result.initial))
    return wrongTarget();
  for (const [index, step] of result.steps.entries()) {
    if (
      !matchesTarget(step.before, launchTime) ||
      (step.after !== null && !matchesTarget(step.after, launchTime))
    )
      return wrongTarget();
    if (
      step.index !== index ||
      step.kind !== input.steps[index]?.kind ||
      (step.outcome === "completed" && step.after === null)
    )
      return err(
        adapterFailure(
          new Error("Windows UI helper returned inconsistent scenario steps"),
        ),
      );
  }
  if (
    result.steps.length !== input.steps.length &&
    result.steps.at(-1)?.outcome !== "cancelled"
  )
    return err(
      adapterFailure(new Error("Windows UI helper omitted scenario steps")),
    );
  return ok(result);
};

const passiveInputSchema = nativeUiObservationInputSchema.transform(
  (input) => ({
    ...input,
    steps: [],
  }),
);
const scenarioInputSchema = nativeUiScenarioInputSchema;
