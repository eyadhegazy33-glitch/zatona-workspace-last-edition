import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadMock, publicUrlMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  publicUrlMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: publicUrlMock,
      }),
    },
  }),
}));

import { uploadBrandingImage } from "./settings";

describe("branding image uploads", () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({
      data: { path: "logos/generated.png" },
      error: null,
    });
    publicUrlMock.mockReset().mockReturnValue({
      data: { publicUrl: "https://storage.example/logos/generated.png" },
    });
  });

  it("uses the MIME type rather than the supplied filename extension", async () => {
    const file = new File(["fake image"], "payload.svg", {
      type: "image/png",
    });

    await uploadBrandingImage(file);

    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^logos\/[0-9a-f-]+\.png$/),
      file,
      { contentType: "image/png", upsert: false },
    );
  });
});
