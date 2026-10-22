import type {
  CapabilityDescriptor,
  ProviderIdentity,
} from "../application/AnalysisProvider.js";
import { NATIVE_TOOL_CONTRACTS } from "../contracts/native/nativeToolContracts.js";

/** Public identity committed by Windows-native UI observations. */
export const NATIVE_WINDOWS_PROVIDER_IDENTITY: ProviderIdentity = Object.freeze({
  id: "native-windows",
  name: "Windows native UI utilities",
  version: null,
});

/** Operations that drive an already-running application window. */
const OWNED_WINDOW_OPERATIONS: ReadonlySet<string> = new Set([
  "capture_native_ui_scenario",
  "observe_native_ui",
]);

/**
 * Declare Windows UI coverage without spawning the helper.
 *
 * Availability is decided by the host platform only; the Python helper's
 * importable dependencies are probed at observation time and reported as an
 * operation failure, so a missing dependency never becomes claimed support.
 */
export const nativeWindowsCapabilities = (
  platform: NodeJS.Platform = process.platform,
): readonly CapabilityDescriptor[] => {
  const available = platform === "win32";
  return Object.freeze(
    [
      "observe_native_ui",
      "capture_native_ui_scenario",
    ]
      .filter((name) =>
        NATIVE_TOOL_CONTRACTS.some((contract) => contract.name === name),
      )
      .map((name): CapabilityDescriptor => {
        const availability = available
          ? ({ available: true, reason: null } as const)
          : ({
              available: false,
              availabilityCode: "unsupported_host",
              reason: "Windows UI Automation requires Windows.",
            } as const);
        return Object.freeze({
          provider: NATIVE_WINDOWS_PROVIDER_IDENTITY,
          operation: name as "observe_native_ui" | "capture_native_ui_scenario",
          ...availability,
          effects: Object.freeze({
            mutatesArtifact: false,
            launchesProcess: true,
            mayShowUi: OWNED_WINDOW_OPERATIONS.has(name),
            mayAccessNetwork: false,
            mayWriteFilesystem: OWNED_WINDOW_OPERATIONS.has(name),
            changesPermissions: false,
            requiresRoot: false,
          }),
          limitations: Object.freeze([
            "Windows UIA exposes control patterns rather than AX roles; node actions are UIA pattern ids.",
            "Requires a Python interpreter with uiautomation and Pillow importable (REA_WINDOWS_PYTHON or PATH).",
            "Screenshots capture the selected window; minimized or occluded windows may yield no image.",
          ]),
        });
      }),
  );
};
