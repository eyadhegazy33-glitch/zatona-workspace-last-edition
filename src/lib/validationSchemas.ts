import { z } from "zod";
import { normalizeHeader, parseImportDate } from "./importParsing";

export const registrationSchema = z.object({
  firstName: z.string().trim().min(2, "register.validation.firstNameMin").max(50, "register.validation.firstNameMax"),
  lastName: z.string().trim().min(2, "register.validation.lastNameMin").max(50, "register.validation.lastNameMax"),
  phoneNumber: z.string().trim().min(1, "register.validation.phoneRequired")
    .regex(/^[+]?[0-9(). -]{7,24}$/, "register.validation.phoneInvalid")
    .refine((value) => {
      const digits = (value.match(/[0-9]/g) ?? []).length;
      return digits >= 7 && digits <= 15;
    }, "register.validation.phoneInvalid"),
  email: z.string().trim().email("register.validation.email"),
  password: z.string().min(8, "register.validation.passwordMin")
    .regex(/(?=.*\p{L})(?=.*\d)/u, "register.validation.passwordComplexity"),
  confirmPassword: z.string().min(1, "register.validation.confirmPassword"),
  requestedRoleId: z.string().min(1, "register.validation.role"),
}).refine((values) => values.password === values.confirmPassword, {
  message: "register.validation.passwordMismatch",
  path: ["confirmPassword"],
});

export const loginSchema = z.object({
  email: z.string().trim().email("login.validation.email"),
  password: z.string().min(1, "login.validation.password"),
});

function parseCustomerDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

export function createCustomerSchema(today = new Date()) {
  const normalizedToday = new Date(today);
  normalizedToday.setHours(0, 0, 0, 0);
  return z.object({
    firstName: z.string().trim().min(2, "customers.validation.firstNameMin").max(50, "customers.validation.firstNameMax"),
    lastName: z.string().trim().min(2, "customers.validation.lastNameMin").max(50, "customers.validation.lastNameMax"),
    birthDate: z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "customers.validation.birthDate")
      .refine((value) => parseCustomerDate(value) !== null, "customers.validation.birthDate")
      .refine((value) => {
        const date = parseCustomerDate(value);
        return date === null || date <= normalizedToday;
      }, "customers.validation.birthDateFuture"),
    studentTypeId: z.string().min(1, "customers.validation.studentType"),
    phone: z.string().trim().refine(
      (value) => value.length === 0 || /^[0-9 +\-]+$/.test(value),
      "customers.validation.phone",
    ),
    expiryDate: z.string().refine(
      (value) => value.length === 0 || parseCustomerDate(value) !== null,
      "customers.validation.expiryDate",
    ),
    notes: z.string().max(2000, "customers.validation.notesMax"),
  }).strict();
}

export const orderSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(50),
    note: z.string().trim().max(150),
  })).min(1).max(50),
  note: z.string().trim().max(500),
  discount: z.number().finite().min(0).max(1_000_000),
  discountReason: z.string().trim().max(250),
}).superRefine((value, context) => {
  if (value.discount > 0 && value.discountReason.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["discountReason"],
      message: "reasonRequired",
    });
  }
});

export type ImportRowSchemaOptions = {
  studentTypes: string[];
  today?: string;
};

export function createImportRowSchema({
  studentTypes,
  today = new Date().toISOString().slice(0, 10),
}: ImportRowSchemaOptions) {
  const normalizedTypes = new Set(studentTypes.map(normalizeHeader));
  return z.object({
    first_name: z.string().trim().min(2, "customers.import.validation.nameMin").max(50, "customers.import.validation.nameMax"),
    last_name: z.string().trim().min(2, "customers.import.validation.nameMin").max(50, "customers.import.validation.nameMax"),
    birth_date: z.string().refine((value) => {
      const parsed = parseImportDate(value);
      return Boolean(parsed && parsed <= today);
    }, "customers.import.validation.birthDate"),
    student_type: z.string().trim().refine(
      (value) => normalizedTypes.has(normalizeHeader(value)),
      "customers.import.validation.studentType",
    ),
    phone: z.string().refine(
      (value) => !value || /^[0-9 +\-]+$/.test(value.trim()),
      "customers.import.validation.phone",
    ),
  });
}
