import { z } from "zod";

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
 * Unlike the macOS path this does not bind a Mach-O target: the window handle
 * (window_id) is the authority and the helper reports the owning executable.
 * The first snapshot binds pid/executable; a later capture that disagrees is
 * a target change, not an observation.
 */
export const observeNativeUiWindows = async (
  operation: "observe_native_ui" | "capture_native_ui_scenario",
  parameters: unknown,
  options: {
    invoke: NativeUiHelper;
    signal?: AbortSignal | undefined;
  },
): Promise<Result<z.infer<typeof nativeUiResultSchema>, AnalysisError>> => {
  const parsed = (
    operation === "observe_native_ui"
      ? passiveInputSchema
      : scenarioInputSchema
  ).safeParse(parameters);
  if (!parsed.success)
    return err(new AnalysisInputError(operation, { cause: parsed.error }));

  const input = parsed.data;
  if (!input.screenshot && !input.accessibility)
    return err(
      new AnalysisInputError(operation, {
        cause: new Error("Enable screenshot or accessibility capture"),
      }),
    );

  const adapterFailure = (cause: unknown): AnalysisError =>
    cause instanceof AnalysisError
      ? cause
      : new ProviderAdapterError(NATIVE_WINDOWS_PROVIDER_ID, operation, {
          cause,
        });

  if (operation === "observe_native_ui") {
    let response: unknown;
    try {
      response = await options.invoke(
        {
          pid: input.pid,
          window_id: input.window_id,
          screenshot: input.screenshot,
          accessibility: input.accessibility,
          max_nodes: input.max_nodes,
        },
        options.signal,
      );
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
    return ok({
      target_sha256: snapshot.window.executable,
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
        pid: input.pid,
        window_id: input.window_id,
        screenshot: input.screenshot,
        accessibility: input.accessibility,
        max_nodes: input.max_nodes,
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
  return ok(parsedResponse.data.result);
};

const passiveInputSchema = nativeUiObservationInputSchema.transform(
  (input) => ({ ...input, steps: [] }),
);
const scenarioInputSchema = nativeUiScenarioInputSchema;
