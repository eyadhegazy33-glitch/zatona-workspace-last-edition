import { describe, expect, it } from "vitest";
import { detectHeaderMatch, parseImportDate } from "./importParsing";

describe("customer-import date parsing", () => {
  it("parses DD/MM/YYYY without locale-dependent Date parsing", () => {
    expect(parseImportDate("03/04/2020", "DD/MM/YYYY")).toBe("2020-04-03");
  });

  it("parses ISO dates and rejects impossible dates", () => {
    expect(parseImportDate("2020-04-03", "YYYY-MM-DD")).toBe("2020-04-03");
    expect(parseImportDate("2020-02-30")).toBeNull();
  });

  it("parses Excel serial dates", () => {
    expect(parseImportDate("45292")).toBe("2024-01-01");
  });
});

describe("customer-import header detection", () => {
  it.each([
    ["First Name", "first_name"],
    ["Date of Birth", "birth_date"],
    ["Phone Number", "phone"],
    ["الاسم الأول", "first_name"],
    ["تاريخ الميلاد", "birth_date"],
    ["نوع الطالب", "student_type"],
    ["الاسم الكامل", "full_name"],
  ])("detects %s", (header, expected) => {
    expect(detectHeaderMatch(header)).toBe(expected);
  });
});
