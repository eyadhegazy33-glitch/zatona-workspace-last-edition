import { expect, it } from "vitest";
import { z } from "zod";
import "./configureZod";

it("disables Zod JIT code generation for strict CSP compatibility", () => {
  expect(z.config().jitless).toBe(true);
});
