export type ImportDateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

const HEADER_ALIASES: Record<string, string> = {
  "first name": "first_name",
  first_name: "first_name",
  firstname: "first_name",
  "الاسم الاول": "first_name",
  "الاسم الأول": "first_name",
  "اسم الاول": "first_name",
  "last name": "last_name",
  last_name: "last_name",
  lastname: "last_name",
  "اسم العائلة": "last_name",
  "birth date": "birth_date",
  birth_date: "birth_date",
  "تاريخ الميلاد": "birth_date",
  "student type": "student_type",
  student_type: "student_type",
  "النوع": "student_type",
  "نوع الطالب": "student_type",
  phone: "phone",
  "الهاتف": "phone",
  "الموبايل": "phone",
  mobile: "phone",
  "full name": "full_name",
  full_name: "full_name",
  fullname: "full_name",
  "الاسم الكامل": "full_name",
};

export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function detectHeaderMatch(rawHeader: string): string {
  const normalized = normalizeHeader(rawHeader);
  if (HEADER_ALIASES[normalized]) return HEADER_ALIASES[normalized];
  if (normalized.includes("first") && normalized.includes("name")) return "first_name";
  if (normalized.includes("last") && normalized.includes("name")) return "last_name";
  if (normalized.includes("birth") || normalized.includes("dob")) return "birth_date";
  if (normalized.includes("student") || normalized.includes("type") || normalized.includes("class")) return "student_type";
  if (normalized.includes("phone") || normalized.includes("mobile") || normalized.includes("tel")) return "phone";
  if (normalized.includes("full") || normalized.includes("fullname")) return "full_name";
  return "";
}

function formatIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeYear(year: number): number {
  return year < 100 ? year + (year < 30 ? 2000 : 1900) : year;
}

function excelSerialDateParts(serial: number): {
  year: number;
  month: number;
  day: number;
} | null {
  const days = Math.floor(serial);
  if (!Number.isFinite(serial) || days < 1 || days > 2_958_465 || days === 60) {
    return null;
  }
  const date = new Date(Date.UTC(1899, 11, 31 + days - (days > 60 ? 1 : 0)));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function parseImportDate(
  value: string,
  format: ImportDateFormat = "DD/MM/YYYY",
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return formatIsoDate(year, month, day);
  }

  if (format === "YYYY-MM-DD") {
    const serial = Number(trimmed);
    if (!Number.isFinite(serial)) return null;
    const excelDate = excelSerialDateParts(serial);
    return excelDate
      ? formatIsoDate(excelDate.year, excelDate.month, excelDate.day)
      : null;
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) {
    const parts = trimmed.split(/[/-]/).map(Number);
    if (trimmed.split(/[/-]/)[0].length === 4) {
      const [year, month, day] = parts;
      return formatIsoDate(normalizeYear(year), month, day);
    }
    const [first, second, rawYear] = parts;
    const year = normalizeYear(rawYear);
    return format === "DD/MM/YYYY"
      ? formatIsoDate(year, second, first)
      : formatIsoDate(year, first, second);
  }

  const serial = Number(trimmed);
  if (!Number.isFinite(serial)) return null;
  const excelDate = excelSerialDateParts(serial);
  return excelDate ? formatIsoDate(excelDate.year, excelDate.month, excelDate.day) : null;
}
