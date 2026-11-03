const cameraErrors: Record<string, string> = {
  NotAllowedError: "scan.camera.permissionDenied",
  NotFoundError: "scan.camera.notFound",
  DevicesNotFoundError: "scan.camera.notFound",
  NotReadableError: "scan.camera.inUse",
  TrackStartError: "scan.camera.inUse",
  OverconstrainedError: "scan.camera.overconstrained",
  ConstraintNotSatisfiedError: "scan.camera.overconstrained",
  SecurityError: "scan.camera.secureContext",
  AbortError: "scan.camera.aborted",
  UnknownError: "scan.camera.deviceError",
};

const cameraErrorName = new RegExp(
  `\\b(${Object.keys(cameraErrors).join("|")})\\b`,
  "i",
);

export function getCameraErrorDetails(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "";
  const directName =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  const name =
    Object.keys(cameraErrors).find(
      (candidate) => candidate.toLowerCase() === directName.toLowerCase(),
    ) ??
    message.match(cameraErrorName)?.[1] ??
    "UnknownError";

  return {
    key: cameraErrors[name] ?? "scan.camera.startFailed",
    name,
  };
}
