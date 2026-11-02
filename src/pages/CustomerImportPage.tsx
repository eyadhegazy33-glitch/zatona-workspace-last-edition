import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Printer,
  RefreshCcw,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { readCustomerSpreadsheet, writeCustomerImportTemplate } from "../lib/sheetjs";
import {
  detectHeaderMatch,
  normalizeHeader,
  parseImportDate,
  type ImportDateFormat,
} from "../lib/importParsing";
import { createImportRowSchema } from "../lib/validationSchemas";
import {
  getActiveStudentTypes,
  type StudentType,
} from "../services/customers";
import { getImportErrors, runCustomerImport } from "../services/imports";

type ImportField = "first_name" | "last_name" | "birth_date" | "student_type" | "phone" | "full_name";

type PreviewRow = {
  normalized: {
    first_name: string;
    last_name: string;
    birth_date: string;
    student_type: string;
    phone: string;
  };
  valid: boolean;
  duplicate: boolean;
  reason: string;
};

type ImportResult = {
  import_id: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

const MAX_ROWS = 5000;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const DATE_FORMATS: ImportDateFormat[] = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const FIELD_ORDER: ImportField[] = [
  "first_name",
  "last_name",
  "birth_date",
  "student_type",
  "phone",
  "full_name",
];

function toIsoDateParts(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function importCellText(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDateParts(value);
  }
  return value == null ? "" : String(value).trim();
}

function splitFullName(value: string): { first_name: string; last_name: string } {
  const clean = value.trim();
  if (!clean) return { first_name: "", last_name: "" };
  const pieces = clean.split(/\s+/);
  if (pieces.length === 1) return { first_name: pieces[0], last_name: "" };
  return {
    first_name: pieces.shift() ?? "",
    last_name: pieces.join(" "),
  };
}

function getStoredDateFormat(): ImportDateFormat {
  const value = window.localStorage.getItem("customer-import-date-format");
  return DATE_FORMATS.includes(value as ImportDateFormat)
    ? (value as ImportDateFormat)
    : "DD/MM/YYYY";
}

function buildCsv(rows: Array<{ row_number: number; reason: string }>): string {
  const lines = ["row_number,reason"] as string[];
  rows.forEach((row) => {
    lines.push(`"${row.row_number}","${row.reason.replace(/"/g, '""')}"`);
  });
  return lines.join("\n");
}

export function CustomerImportPage() {
  const { i18n, t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [studentTypes, setStudentTypes] = useState<StudentType[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [fullNameInOneColumn, setFullNameInOneColumn] = useState(false);
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>(getStoredDateFormat);
  const [progress, setProgress] = useState(false);
  const [error, setError] = useState("");
  const [previewSummary, setPreviewSummary] = useState({ valid: 0, invalid: 0, duplicates: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultErrors, setResultErrors] = useState<Array<{ row_number: number; reason: string }>>([]);
  const [loadingErrorReport, setLoadingErrorReport] = useState(false);
  const [errorReportLoaded, setErrorReportLoaded] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [pendingImportCount, setPendingImportCount] = useState(0);

  useEffect(() => {
    void getActiveStudentTypes()
      .then((types) => setStudentTypes(types))
      .catch(() => setError(t("customers.import.errors.studentTypes")));
  }, [t]);

  useEffect(() => {
    if (!headers.length) return;
    const detected: Record<string, string> = {};
    headers.forEach((header) => {
      const key = detectHeaderMatch(header);
      if (key) detected[key] = header;
    });
    setColumnMap((current) => ({
      ...Object.fromEntries(
        FIELD_ORDER.map((field) => [field, current[field] ?? detected[field] ?? ""]),
      ),
    }));
  }, [headers]);

  const headerOptions = useMemo(() => ["", ...headers], [headers]);

  const previewData = useMemo(() => {
    if (!rows.length) return [] as PreviewRow[];
    const seen = new Set<string>();
    const activeTypeNames = new Map(
      studentTypes.flatMap((type) => [
        [normalizeHeader(type.name_en), type.name_en],
        [normalizeHeader(type.name_ar), type.name_en],
      ]),
    );
    const schema = createImportRowSchema({
      studentTypes: [...activeTypeNames.keys()],
      today: toIsoDateParts(new Date()),
    });
    const preview: PreviewRow[] = [];

    rows.forEach((row) => {
      const source = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, String(value ?? "").trim()]),
      );
      const firstNameRaw = fullNameInOneColumn
        ? ""
        : columnMap.first_name
          ? (source[columnMap.first_name] ?? "")
          : "";
      const lastNameRaw = fullNameInOneColumn
        ? ""
        : columnMap.last_name
          ? (source[columnMap.last_name] ?? "")
          : "";
      const fullNameRaw = fullNameInOneColumn && columnMap.full_name ? source[columnMap.full_name] ?? "" : "";
      const { first_name: fullFirst, last_name: fullLast } = splitFullName(
        fullNameRaw || `${firstNameRaw} ${lastNameRaw}`.trim(),
      );

      const firstName = (fullNameInOneColumn ? fullFirst : firstNameRaw).trim();
      const lastName = (fullNameInOneColumn ? fullLast : lastNameRaw).trim();
      const birthRaw = columnMap.birth_date ? source[columnMap.birth_date] ?? "" : "";
      const studentRaw = columnMap.student_type ? source[columnMap.student_type] ?? "" : "";
      const phoneRaw = columnMap.phone ? source[columnMap.phone] ?? "" : "";
      const parsedBirth = parseImportDate(birthRaw, dateFormat);
      const normalizedStudent = studentRaw.trim();
      const normalizedPhone = phoneRaw.trim();
      const normalizedRow = {
        first_name: firstName,
        last_name: lastName,
        birth_date: parsedBirth ?? "",
        student_type: normalizedStudent,
        phone: normalizedPhone,
      };

      const parsed = schema.safeParse(normalizedRow);
      const duplicateKeys = [
        `person:${JSON.stringify([
          normalizedRow.first_name.toLowerCase(),
          normalizedRow.last_name.toLowerCase(),
          normalizedRow.birth_date,
        ])}`,
        ...(normalizedRow.phone ? [`phone:${normalizedRow.phone}`] : []),
      ];
      let duplicate = false;
      let reason = "";
      if (parsed.success) {
        if (duplicateKeys.some((key) => seen.has(key))) {
          duplicate = true;
          reason = t("customers.import.validation.duplicate");
        }
        duplicateKeys.forEach((key) => seen.add(key));
      } else {
        reason = parsed.error.issues.map((issue) => t(issue.message)).join("; ");
      }

      preview.push({
        normalized: {
          first_name: normalizedRow.first_name,
          last_name: normalizedRow.last_name,
          birth_date: normalizedRow.birth_date,
          student_type: activeTypeNames.get(normalizeHeader(normalizedStudent)) ?? normalizedStudent,
          phone: normalizedPhone,
        },
        valid: parsed.success && !duplicate,
        duplicate,
        reason,
      });
    });

    return preview;
  }, [columnMap, dateFormat, fullNameInOneColumn, rows, studentTypes, t]);

  useEffect(() => {
    setPreviewSummary({
      valid: previewData.filter((row) => row.valid).length,
      invalid: previewData.filter((row) => !row.valid && !row.duplicate).length,
      duplicates: previewData.filter((row) => row.duplicate).length,
    });
  }, [previewData]);

  const validRowsForImport = useMemo(
    () =>
      previewData
        .filter((row) => row.valid)
        .map((row) => ({
          first_name: row.normalized.first_name,
          last_name: row.normalized.last_name,
          birth_date: row.normalized.birth_date,
          student_type: row.normalized.student_type,
          phone: row.normalized.phone,
        })),
    [previewData],
  );

  const canContinueFromMapping = useMemo(() => {
    if (fullNameInOneColumn) return Boolean(columnMap.full_name && columnMap.birth_date && columnMap.student_type);
    return ["first_name", "last_name", "birth_date", "student_type"].every((field) => Boolean(columnMap[field]));
  }, [columnMap, fullNameInOneColumn]);

  const loadFile = async (file: File) => {
    setError("");
    if (file.size > MAX_FILE_SIZE) {
      setError(t("customers.import.errors.fileSize"));
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx", "csv"].includes(extension)) {
      setError(t("customers.import.errors.fileType"));
      return;
    }

    try {
      const rawRows = readCustomerSpreadsheet(await file.arrayBuffer());
      if (!rawRows.length) {
        setError(t("customers.import.errors.empty"));
        return;
      }
      if (rawRows.length - 1 > MAX_ROWS) {
        setError(t("customers.import.errors.maxRows", { maxRows: MAX_ROWS }));
        return;
      }

      const firstRow = rawRows[0] as unknown[];
      const headersFromSheet = firstRow.map((value) => String(value ?? "").trim());
      const dataRows = (rawRows.slice(1) as unknown[][]).map((row) => {
        const record: Record<string, string> = {};
        headersFromSheet.forEach((header, index) => {
          record[header] = importCellText(row[index]);
        });
        return record;
      });

      setHeaders(headersFromSheet);
      setRows(dataRows);
      setFileName(file.name);
      setStep(2);
    } catch {
      setError(t("customers.import.errors.parse"));
    }
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const downloadTemplate = () => {
    try {
      writeCustomerImportTemplate(t("customers.import.templateExample"));
      setError("");
    } catch {
      setError(t("customers.import.errors.parse"));
    }
  };

  const handleContinueToPreview = () => {
    if (!canContinueFromMapping) {
      setError(t("customers.import.errors.mapping"));
      return;
    }
    setError("");
    setStep(3);
  };

  const handleConfirmImport = async () => {
    if (!validRowsForImport.length) {
      setError(t("customers.import.errors.noValidRows"));
      return;
    }

    setProgress(true);
    setError("");
    try {
      const payload = validRowsForImport.map((row) => ({
        first_name: row.first_name,
        last_name: row.last_name,
        birth_date: row.birth_date,
        student_type: row.student_type,
        phone: row.phone || "",
      }));
      const response = await runCustomerImport({
        rows: payload,
        filename: fileName,
        updateExisting,
      });
      setPendingImportCount(payload.length);
      setResult(response);
      setLoadingErrorReport(true);
      setStep(4);
      try {
        const errors = await getImportErrors(response.import_id);
        setResultErrors(
          errors.map((item) => ({
            row_number: item.row_number,
            reason: item.reason,
          })),
        );
        setErrorReportLoaded(true);
      } catch {
        setErrorReportLoaded(false);
        setError(t("customers.import.errors.errorReport"));
      } finally {
        setLoadingErrorReport(false);
      }
    } catch (importError) {
      setError(t("customers.import.errors.importFailed"));
    } finally {
      setProgress(false);
    }
  };

  const downloadErrorReport = async () => {
    if (!result) return;
    setLoadingErrorReport(true);
    setError("");
    try {
      let errors = resultErrors;
      if (!errorReportLoaded) {
        errors = (await getImportErrors(result.import_id)).map((item) => ({
          row_number: item.row_number,
          reason: item.reason,
        }));
        setResultErrors(errors);
        setErrorReportLoaded(true);
      }

      const csv = buildCsv(errors);
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `import-errors-${result.import_id}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErrorReportLoaded(false);
      setError(t("customers.import.errors.errorReport"));
    } finally {
      setLoadingErrorReport(false);
    }
  };

  const mapFields = fullNameInOneColumn
    ? ["full_name", "birth_date", "student_type", "phone"]
    : ["first_name", "last_name", "birth_date", "student_type", "phone"];

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">{t("customers.import.title")}</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink dark:text-white">{t("customers.import.stepTitle")}</h1>
        </div>
        <Link className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200" to="/customers/import/history">
          <RefreshCcw size={16} />
          {t("customers.import.historyLink")}
        </Link>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-4">
        {[1, 2, 3, 4].map((value) => (
          <div className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
            step === value
              ? "border-brand bg-brand/10 text-brand"
              : step > value
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400"
          }`} key={value}>
            {t(`customers.import.steps.${value}`)}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${isDragging ? "border-brand bg-brand/5" : "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"}`} onDragLeave={() => setIsDragging(false)} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
            <input accept=".xlsx,.csv" className="hidden" onChange={handleFileSelection} ref={fileInputRef} type="file" />
            <FileSpreadsheet className="mx-auto mb-3 text-brand" size={42} />
            <p className="text-lg font-semibold text-ink dark:text-white">{t("customers.import.uploadTitle")}</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("customers.import.uploadDescription")}</p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
              <UploadCloud size={16} /> {t("customers.import.chooseFile")}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200" onClick={downloadTemplate} type="button">
              <Download size={16} /> {t("customers.import.downloadTemplate")}
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">{t("customers.import.fileRules", { maxRows: MAX_ROWS, maxSize: "5 MB" })}</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink dark:text-white">{t("customers.import.mapTitle")}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{fileName}</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input checked={fullNameInOneColumn} onChange={(event) => setFullNameInOneColumn(event.target.checked)} type="checkbox" />
              {t("customers.import.fullNameOneColumn")}
            </label>
          </div>

          <div className="mb-5 grid gap-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-950 md:grid-cols-2 xl:grid-cols-3">
            {mapFields.map((field) => (
              <label className="flex flex-col gap-2" key={field}>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(`customers.import.fields.${field}`)}</span>
                <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => setColumnMap((current) => ({ ...current, [field]: event.target.value }))} value={columnMap[field] ?? ""}>
                  <option value="">{t("customers.import.chooseColumn")}</option>
                  {headerOptions.map((header) => (
                    <option key={header || "blank"} value={header}>{header || t("customers.import.unspecified")}</option>
                  ))}
                </select>
              </label>
            ))}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("customers.import.dateFormat")}</span>
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" onChange={(event) => { const next = event.target.value as ImportDateFormat; setDateFormat(next); window.localStorage.setItem("customer-import-date-format", next); }} value={dateFormat}>
                {DATE_FORMATS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200" onClick={() => setStep(1)} type="button">
              <ArrowLeft size={16} /> {t("customers.import.back")}
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={!canContinueFromMapping} onClick={handleContinueToPreview} type="button">
              {t("customers.import.previewStep")} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink dark:text-white">{t("customers.import.previewTitle")}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{t("customers.import.previewHelp")}</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input checked={updateExisting} onChange={(event) => setUpdateExisting(event.target.checked)} type="checkbox" />
              {t("customers.import.updateExisting")}
            </label>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{t("customers.import.valid")}</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-900 dark:text-emerald-200">{previewSummary.valid}</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
              <p className="text-xs uppercase tracking-wide text-red-700 dark:text-red-300">{t("customers.import.invalid")}</p>
              <p className="mt-2 text-2xl font-semibold text-red-900 dark:text-red-200">{previewSummary.invalid}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">{t("customers.import.duplicates")}</p>
              <p className="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-200">{previewSummary.duplicates}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-950">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">{t("customers.import.fields.firstName")}</th>
                  <th className="px-3 py-2 font-semibold">{t("customers.import.fields.lastName")}</th>
                  <th className="px-3 py-2 font-semibold">{t("customers.import.fields.birthDate")}</th>
                  <th className="px-3 py-2 font-semibold">{t("customers.import.fields.studentType")}</th>
                  <th className="px-3 py-2 font-semibold">{t("customers.import.fields.phone")}</th>
                  <th className="px-3 py-2 font-semibold">{t("customers.import.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {previewData.slice(0, 100).map((row, index) => (
                  <tr className={`${row.valid ? "bg-emerald-50/40 dark:bg-emerald-950/20" : row.duplicate ? "bg-amber-50 dark:bg-amber-950/20" : "bg-red-50 dark:bg-red-950/20"}`} key={`${row.normalized.first_name}-${row.normalized.last_name}-${index}`}>
                    <td className="px-3 py-2 font-medium">{index + 1}</td>
                    <td className="px-3 py-2">{row.normalized.first_name || "—"}</td>
                    <td className="px-3 py-2">{row.normalized.last_name || "—"}</td>
                    <td className="px-3 py-2">{row.normalized.birth_date || "—"}</td>
                    <td className="px-3 py-2">{row.normalized.student_type || "—"}</td>
                    <td className="px-3 py-2">{row.normalized.phone || "—"}</td>
                    <td className="px-3 py-2">
                      {row.valid ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 size={12} /> {t("customers.import.validShort")}</span>
                      ) : row.duplicate ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"><Info size={12} /> {t("customers.import.duplicateShort")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300"><XCircle size={12} /> {t("customers.import.invalidShort")}</span>
                      )}
                      {row.reason && <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{row.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200" onClick={() => setStep(2)} type="button">
              <ArrowLeft size={16} /> {t("customers.import.back")}
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={progress || !validRowsForImport.length} onClick={handleConfirmImport} type="button">
              {progress ? t("customers.import.importing") : t("customers.import.confirmImport")}
            </button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center gap-3">
            <CheckCircle2 className="text-emerald-600" size={28} />
            <div>
              <h2 className="text-2xl font-semibold text-ink dark:text-white">{t("customers.import.completeTitle")}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{t("customers.import.completedMessage")}</p>
            </div>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-5">
            {[
              { key: "created", value: result.created },
              { key: "updated", value: result.updated },
              { key: "skipped", value: result.skipped },
              { key: "failed", value: result.failed },
              { key: "total", value: pendingImportCount },
            ].map((metric) => (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950" key={metric.key}>
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{t(`customers.import.result.${metric.key}`)}</p>
                <p className="mt-2 text-2xl font-semibold text-ink dark:text-white">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200" disabled={loadingErrorReport} onClick={downloadErrorReport} type="button">
              <Download size={16} /> {loadingErrorReport ? t("customers.import.loadingErrorReport") : t("customers.import.downloadErrors")}
            </button>
            <Link className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white" to={`/customers/cards/print?import=${result.import_id}`}>
              <Printer size={16} /> {t("customers.import.printCards")}
            </Link>
            <Link className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200" to="/customers/import/history">
              <ArrowLeft size={16} /> {t("customers.import.historyLink")}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
