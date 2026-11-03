import { describe, expect, it } from "vitest";
import { getCameraErrorDetails } from "./cameraErrors";

describe("camera startup errors", () => {
  it("recognizes errors wrapped by the QR library in a string", () => {
    expect(
      getCameraErrorDetails(
        "Error getting userMedia, error = NotReadableError: Could not start video source",
      ),
    ).toEqual({ key: "scan.camera.inUse", name: "NotReadableError" });
  });

  it("maps browser permission errors to actionable guidance", () => {
    expect(
      getCameraErrorDetails(
        new DOMException("Permission denied", "NotAllowedError"),
      ),
    ).toEqual({
      key: "scan.camera.permissionDenied",
      name: "NotAllowedError",
    });
  });

  it("handles unknown device errors without mislabeling them as permission failures", () => {
    expect(
      getCameraErrorDetails(
        "Error getting userMedia, error = UnknownError: Could not start device",
      ),
    ).toEqual({ key: "scan.camera.deviceError", name: "UnknownError" });
  });
});
