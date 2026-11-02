import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryCalls, queryResult } = vi.hoisted(() => ({
  queryCalls: [] as Array<[string, ...unknown[]]>,
  queryResult: { data: [], error: null, count: 0 },
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      queryCalls.push(["from", table]);
      const builder = {
        select: (...args: unknown[]) => {
          queryCalls.push(["select", ...args]);
          return builder;
        },
        is: (...args: unknown[]) => {
          queryCalls.push(["is", ...args]);
          return builder;
        },
        order: (...args: unknown[]) => {
          queryCalls.push(["order", ...args]);
          return builder;
        },
        range: (...args: unknown[]) => {
          queryCalls.push(["range", ...args]);
          return builder;
        },
        or: (...args: unknown[]) => {
          queryCalls.push(["or", ...args]);
          return builder;
        },
        then: (resolve: (value: typeof queryResult) => unknown) =>
          Promise.resolve(queryResult).then(resolve),
      };
      return builder;
    },
  }),
}));

import { getCustomers } from "./customers";

describe("customer search query", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("uses indexed full-name, code, and phone filters with server pagination", async () => {
    await getCustomers({
      search: "  sample  ",
      status: "",
      studentTypeId: "",
      sort: "created_at",
      ascending: false,
      page: 2,
      pageSize: 25,
    });

    expect(queryCalls).toContainEqual([
      "or",
      "full_name.ilike.%sample%,code.ilike.%sample%,phone.ilike.%sample%",
    ]);
    expect(queryCalls).toContainEqual(["range", 50, 74]);
  });
});
