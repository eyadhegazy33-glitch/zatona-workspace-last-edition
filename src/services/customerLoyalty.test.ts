import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: rpcMock }),
}));

import {
  adjustCustomerLoyaltyPoints,
  getCustomerLoyaltyPortal,
} from "./customerLoyalty";

describe("customer loyalty adjustments", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("returns the confirmed server-side balance after recording an adjustment", async () => {
    rpcMock.mockResolvedValue({ data: 125, error: null });

    await expect(adjustCustomerLoyaltyPoints({
      customerCode: "TEST-001",
      points: 25,
      reason: "Test adjustment",
    })).resolves.toBe(125);

    expect(rpcMock).toHaveBeenCalledWith("adjust_customer_loyalty_points", {
      p_customer_code: "TEST-001",
      p_points: 25,
      p_reason: "Test adjustment",
    });
  });

  it("does not treat a missing or invalid balance as a confirmed adjustment", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await expect(adjustCustomerLoyaltyPoints({
      customerCode: "TEST-001",
      points: 25,
      reason: "Test adjustment",
    })).rejects.toThrow("Loyalty adjustment response was invalid.");
  });

  it("propagates an RPC failure without reporting success", async () => {
    const error = new Error("RPC failed");
    rpcMock.mockResolvedValue({ data: null, error });

    await expect(adjustCustomerLoyaltyPoints({
      customerCode: "TEST-001",
      points: 25,
      reason: "Test adjustment",
    })).rejects.toBe(error);
  });

  it("fetches current balance and adjustment history from the server", async () => {
    rpcMock.mockResolvedValue({
      data: {
        customer: { id: "fake-customer-id", code: "TEST-001", name: "Test Student" },
        points: 125,
        rewards: [],
        history: [{
          id: 1,
          points: 25,
          entry_type: "manual_adjustment",
          created_at: "2026-01-01T12:00:00Z",
        }],
        redemptions: [],
      },
      error: null,
    });

    const result = await getCustomerLoyaltyPortal("a".repeat(64));

    expect(result.points).toBe(125);
    expect(result.history).toEqual([{
      id: 1,
      points: 25,
      entry_type: "manual_adjustment",
      created_at: "2026-01-01T12:00:00Z",
    }]);
    expect(rpcMock).toHaveBeenCalledWith("get_customer_loyalty_portal", {
      p_token: "a".repeat(64),
    });
  });
});
