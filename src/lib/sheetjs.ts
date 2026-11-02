import * as XLSX from "xlsx";

export function readCustomerSpreadsheet(data: ArrayBuffer): unknown[][] {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    blankrows: false,
    raw: true,
  });
}

export function writeCustomerImportTemplate(exampleRowLabel: string): void {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["first_name", "last_name", "birth_date", "student_type", "phone"],
    [
      exampleRowLabel,
      "Example",
      "2000-01-01",
      exampleRowLabel,
      "0500000000",
    ],
  ]);
  sheet.A2.c = [
    {
      a: "Elzatona",
      t: exampleRowLabel,
    },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Customers");
  XLSX.writeFileXLSX(workbook, "customer_import_template.xlsx");
}

export function writeReceiptExport(
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((header) => ({
    wch: Math.min(32, Math.max(14, header.length + 3)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Receipts");
  XLSX.writeFileXLSX(workbook, "zatona_receipts.xlsx");
}

export function writeBookingExport(
  headers: string[],
  rows: Array<Array<string | number>>,
): void {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = headers.map((header) => ({
    wch: Math.min(32, Math.max(14, header.length + 3)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Bookings");
  XLSX.writeFileXLSX(workbook, "zatona_bookings.xlsx");
}

export function writeDashboardExport(
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<Array<string | number>>;
  }>,
  filename: string,
): void {
  if (sheets.length === 0) throw new Error("The dashboard export has no sheets.");
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    worksheet["!cols"] = sheet.headers.map((header) => ({
      wch: Math.min(36, Math.max(12, header.length + 3)),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  XLSX.writeFileXLSX(workbook, filename);
}

export function excelSerialDateParts(serial: number): {
  year: number;
  month: number;
  day: number;
} | null {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  return { year: parsed.y, month: parsed.m, day: parsed.d };
}
