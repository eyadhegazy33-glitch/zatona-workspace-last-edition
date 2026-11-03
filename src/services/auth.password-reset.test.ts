import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({
    auth: { resetPasswordForEmail },
  }),
}));

import { AuthServiceError, sendPasswordReset } from "./auth";

describe("password recovery", () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    vi.stubGlobal("window", {
      location: { origin: "https://zatona-workspace-last-edition.pages.dev" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a recovery email with the app's reset-password callback", async () => {
    await sendPasswordReset("staff@example.test");

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "staff@example.test",
      {
        redirectTo:
          "https://zatona-workspace-last-edition.pages.dev/reset-password",
      },
    );
  });

  it("reports when Supabase rejects the configured recovery redirect", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: {
        code: "redirect_to_not_allowed",
        message: "Redirect URL is not allowed",
        status: 400,
      },
    });

    await expect(sendPasswordReset("staff@example.test")).rejects.toMatchObject<
      Partial<AuthServiceError>
    >({ messageKey: "auth.errors.redirectNotAllowed" });
  });
});
