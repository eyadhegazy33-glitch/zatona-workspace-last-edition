import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({ rpc: rpcMock }),
}));

import { listAuditScans } from "./auditLog";

describe("listAuditScans", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("sends result and exclusive timestamp bounds to the paginated RPC", async () => {
    rpcMock.mockResolvedValue({
      data: { total_count: 0, rows: [] },
      error: null,
    });

    await expect(listAuditScans(
      "blocked",
      "2026-10-31T21:00:00.000Z",
      "2026-11-01T22:00:00.000Z",
      50,
      100,
    )).resolves.toEqual({ total_count: 0, rows: [] });

    expect(rpcMock).toHaveBeenCalledWith("list_audit_scans", {
      p_result: "blocked",
      p_from: "2026-10-31T21:00:00.000Z",
      p_to: "2026-11-01T22:00:00.000Z",
      p_limit: 50,
      p_offset: 100,
    });
  });

  it("propagates RPC failures", async () => {
    const error = new Error("RPC failed");
    rpcMock.mockResolvedValue({ data: null, error });

    await expect(listAuditScans(null, null, null, 50, 0)).rejects.toBe(error);
  });
});
