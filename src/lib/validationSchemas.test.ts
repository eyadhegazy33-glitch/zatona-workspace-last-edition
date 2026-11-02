import { describe, expect, it } from "vitest";
import {
  createCustomerSchema,
  createImportRowSchema,
  loginSchema,
  orderSchema,
  registrationSchema,
} from "./validationSchemas";

const customerId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";

describe("registrationSchema", () => {
  const valid = {
    firstName: "Test",
    lastName: "Employee",
    phoneNumber: "+1 202 555 0100",
    email: "test.employee@example.invalid",
    password: "FakePass123",
    confirmPassword: "FakePass123",
    requestedRoleId: "00000000-0000-4000-8000-000000000003",
  };

  it("accepts valid fake registration input", () => {
    expect(registrationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched passwords and malformed email", () => {
    expect(registrationSchema.safeParse({ ...valid, confirmPassword: "Other1234" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts valid login fields and rejects missing password", () => {
    expect(loginSchema.safeParse({ email: "tester@example.invalid", password: "fake" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "tester@example.invalid", password: "" }).success).toBe(false);
  });
});

describe("createCustomerSchema", () => {
  const schema = createCustomerSchema(new Date(2025, 5, 10, 12));
  const valid = {
    firstName: "Fake",
    lastName: "Customer",
    birthDate: "2010-03-20",
    studentTypeId: customerId,
    phone: "2025550199",
    expiryDate: "",
    notes: "",
  };

  it("accepts valid fake customer data", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid calendar dates, future birth dates, and unknown fields", () => {
    expect(schema.safeParse({ ...valid, birthDate: "2010-02-30" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, birthDate: "2025-06-11" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});

describe("orderSchema", () => {
  const valid = {
    customerId,
    items: [{ menu_item_id: itemId, quantity: 1, note: "" }],
    note: "",
    discount: 0,
    discountReason: "",
  };

  it("accepts valid fake orders and quantity boundary 50", () => {
    expect(orderSchema.safeParse(valid).success).toBe(true);
    expect(orderSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0], quantity: 50 }],
    }).success).toBe(true);
  });

  it("rejects invalid quantities, identifiers, and discount without a reason", () => {
    expect(orderSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0], quantity: 0 }],
    }).success).toBe(false);
    expect(orderSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0], quantity: 51 }],
    }).success).toBe(false);
    expect(orderSchema.safeParse({ ...valid, customerId: "not-a-uuid" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...valid, discount: 2 }).success).toBe(false);
  });
});

describe("createImportRowSchema", () => {
  const schema = createImportRowSchema({
    studentTypes: ["secondary", "المرحلة الثانوية"],
    today: "2025-06-10",
  });
  const valid = {
    first_name: "Fake",
    last_name: "Student",
    birth_date: "2010-03-20",
    student_type: "المرحلة الثانوية",
    phone: "2025550100",
  };

  it("accepts a valid row with localized student type", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("rejects future dates and malformed phone values", () => {
    expect(schema.safeParse({ ...valid, birth_date: "2025-06-11" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, phone: "call me" }).success).toBe(false);
  });
});
