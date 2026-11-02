import { describe, expect, it } from "vitest";
import { uploadIncidentPhoto } from "./incidents";
import { uploadChecklistPhoto } from "./quality";

const oversizedPng = () =>
  new File([new Uint8Array(5 * 1024 * 1024 + 1)], "photo.png", {
    type: "image/png",
  });

describe("private attachment upload validation", () => {
  for (const [label, upload] of [
    ["incident", uploadIncidentPhoto],
    ["checklist", uploadChecklistPhoto],
  ] as const) {
    it(`rejects unsupported image formats for ${label} photos`, async () => {
      const svg = new File(["<svg />"], "photo.svg", {
        type: "image/svg+xml",
      });

      await expect(upload(svg)).rejects.toThrow("invalid_image");
    });

    it(`rejects files larger than 5 MiB for ${label} photos`, async () => {
      await expect(upload(oversizedPng())).rejects.toThrow("image_too_large");
    });
  }
});
