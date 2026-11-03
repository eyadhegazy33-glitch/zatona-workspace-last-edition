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
import { sendEmployeePasswordReset } from "./employees";

describe("password recovery", () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a recovery email with the canonical Cloudflare callback", async () => {
    await sendPasswordReset("staff@example.test");

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "staff@example.test",
      {
        redirectTo: "https://zatona-workspace-last-edition.pages.dev/reset-password",
      },
    );
  });

  it("uses the same callback for employee-initiated password resets", async () => {
    await sendEmployeePasswordReset("staff@example.test");

    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "staff@example.test",
      {
        redirectTo: "https://zatona-workspace-last-edition.pages.dev/reset-password",
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
