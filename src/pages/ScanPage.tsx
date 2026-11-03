import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Camera,
  CheckCircle2,
  DoorClosed,
  DoorOpen,
  LoaderCircle,
  ShieldAlert,
  ShoppingBasket,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getSupabaseClient } from "../lib/supabase";
import { useResources } from "../hooks/useResources";
import { getStudentTypeName } from "../services/customers";
import { TimerWidget } from "../components/TimerWidget";
import { CheckoutDialog } from "../components/CheckoutDialog";
import { CustomerFeedbackDialog } from "../components/CustomerFeedbackDialog";
import type { CheckoutTicket } from "../services/pointOfSale";

type ScanReason = "ok" | "blocked" | "expired" | "unknown";

type ScanCustomerPayload = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  student_type?: { name_en: string; name_ar: string } | null;
};

type ScanResponse = {
  ok: boolean;
  reason: ScanReason;
  customer?: ScanCustomerPayload;
  checkin?: {
    id: number;
    checked_in_at: string;
    timer_started_at?: string;
    last_qualifying_order_at?: string | null;
    resource_id?: string | null;
    customer_id?: string;
  } | null;
};

type LiveInsideRow = {
  id: number;
  checked_in_at: string;
  customer_id: string;
  resource_id: string | null;
  customer?: { id: string; code: string; first_name: string; last_name: string } | null;
  resource?: { id: string; name: string; type: string } | null;
};

type ToastState = { kind: "success" | "error"; message: string } | null;

type LastScanState = {
  value: string;
  at: number;
};

const SCAN_COOLDOWN_MS = 3000;
const RESULT_RESET_MS = 5000;
const CAMERA_DEVICE_STORAGE_KEY = "elzatona.camera.deviceId";

function getCameraError(error: unknown) {
  const name = error instanceof DOMException
    ? error.name
    : error instanceof Error
      ? error.name
      : "UnknownError";
  const keyByName: Record<string, string> = {
    NotAllowedError: "scan.camera.permissionDenied",
    NotFoundError: "scan.camera.notFound",
    DevicesNotFoundError: "scan.camera.notFound",
    NotReadableError: "scan.camera.inUse",
    TrackStartError: "scan.camera.inUse",
    OverconstrainedError: "scan.camera.overconstrained",
    ConstraintNotSatisfiedError: "scan.camera.overconstrained",
    SecurityError: "scan.camera.secureContext",
    AbortError: "scan.camera.aborted",
    UnknownError: "scan.camera.deviceError",
  };
  return { key: keyByName[name] ?? "scan.camera.startFailed", name };
}

function formatBirthDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function getFriendlyScanError(message: string, t: (key: string) => string) {
  const normalized = message.toLowerCase();
  const keys: Array<[string, string]> = [
    ["already checked in", "scan.errors.alreadyCheckedIn"],
    ["resource is full", "scan.errors.resourceFull"],
    ["resource not available", "scan.errors.resourceNotAvailable"],
    ["customer not allowed to enter", "scan.errors.customerNotAllowed"],
    ["customer not found", "scan.errors.customerNotFound"],
    ["open shift required", "scan.errors.openShiftRequired"],
    ["not allowed", "scan.errors.notAllowed"],
  ];
  return t(keys.find(([phrase]) => normalized.includes(phrase))?.[1] ?? "scan.errors.general");
}

function extractFeesDue(data: unknown): { amount: number; currency: string } {
  if (typeof data === "number") return { amount: data, currency: "EGP" };
  if (Array.isArray(data)) return extractFeesDue(data[0]);
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const amount = record.fees_due ?? record.feesDue;
    return {
      amount: typeof amount === "number" ? amount : Number(amount) || 0,
      currency: typeof record.currency === "string" ? record.currency : "EGP",
    };
  }
  return { amount: 0, currency: "EGP" };
}

function formatDateTime(value: string, locale: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(
  amount: number,
  currency: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function playAlert(kind: "success" | "error", muted: boolean) {
  if (muted) return;
  const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;

  const context = new AudioCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = kind === "success" ? "sine" : "square";
  oscillator.frequency.value = kind === "success" ? 880 : 220;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.addEventListener("ended", () => {
    void context.close();
  }, { once: true });
  oscillator.start();
  oscillator.stop(context.currentTime + (kind === "success" ? 0.12 : 0.18));
}

export function ScanPage() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerLifecycleRef = useRef<Promise<void>>(Promise.resolve());
  const scannerRunningRef = useRef(false);
  const scannerStartingRef = useRef(false);
  const stopScannerRef = useRef<() => Promise<void>>(async () => undefined);
  const startScannerRef = useRef<() => void>(() => undefined);
  const testVideoRef = useRef<HTMLVideoElement | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const testTimerRef = useRef<number | null>(null);
  const lastScanRef = useRef<LastScanState | null>(null);
  const resultResetTimerRef = useRef<number | null>(null);
  const handleScanValueRef = useRef<(value: string) => Promise<void>>(async () => undefined);
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [cameraError, setCameraError] = useState<{
    message: string;
    name?: string;
  } | null>(null);
  const [cameraDevices, setCameraDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState(() =>
    window.localStorage.getItem(CAMERA_DEVICE_STORAGE_KEY) ?? "",
  );
  const [testingCamera, setTestingCamera] = useState(false);
  const [cameraTestResult, setCameraTestResult] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const { resources: availableResources, reload: reloadResources } = useResources({ onlyUsable: true });
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [insideNow, setInsideNow] = useState<LiveInsideRow[]>([]);
  const [lastScans, setLastScans] = useState<LastScanState[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<"checkin" | "checkout" | null>(null);
  const [checkoutCheckinId, setCheckoutCheckinId] = useState<number | null>(null);
  const [feedbackCustomerId, setFeedbackCustomerId] = useState<string | null>(null);
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [insideError, setInsideError] = useState(false);
  const currentLocale = i18n.language || "en";

  const resetResult = useCallback(() => {
    setResult(null);
    setToast(null);
    resultResetTimerRef.current = null;
    inputRef.current?.focus();
  }, []);

  const scheduleResultReset = useCallback(() => {
    if (resultResetTimerRef.current !== null) {
      window.clearTimeout(resultResetTimerRef.current);
    }
    resultResetTimerRef.current = window.setTimeout(
      resetResult,
      RESULT_RESET_MS,
    );
  }, [resetResult]);

  const refreshInsideNow = useCallback(async () => {
    const client = getSupabaseClient();
    const checkinsResult = await client
      .from("checkins")
      .select("id, checked_in_at, customer_id, resource_id")
      .is("checked_out_at", null)
      .order("checked_in_at", { ascending: false })
      .limit(20);

    if (checkinsResult.error) {
      setInsideError(true);
      return;
    }
    const rows = (checkinsResult.data ?? []) as Array<{
      id: number;
      checked_in_at: string;
      customer_id: string;
      resource_id: string | null;
    }>;
    if (rows.length === 0) {
      setInsideNow([]);
      setInsideError(false);
      return;
    }

    const customerIds = [...new Set(rows.map((row) => row.customer_id))];
    const resourceIds = [...new Set(rows.map((row) => row.resource_id).filter(Boolean))] as string[];
    const [customersResult, resourcesResult] = await Promise.all([
      client
        .from("customers")
        .select("id, code, first_name, last_name")
        .in("id", customerIds),
      resourceIds.length
        ? client.from("resources").select("id, name, type").in("id", resourceIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (customersResult.error || resourcesResult.error) {
      setInsideError(true);
      return;
    }
    const customersById = new Map((customersResult.data ?? []).map((customer) => [customer.id, customer]));
    const resourcesById = new Map((resourcesResult.data ?? []).map((resource) => [resource.id, resource]));
    setInsideNow(rows.map((row) => ({
      ...row,
      customer: customersById.get(row.customer_id),
      resource: row.resource_id ? resourcesById.get(row.resource_id) : null,
    })));
    setInsideError(false);
  }, []);

  const loadCustomerMeta = useCallback(async (customerId: string) => {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("customers")
      .select(
        "id, code, first_name, last_name, birth_date, student_type:student_types(name_en, name_ar)",
      )
      .eq("id", customerId)
      .single();

    if (!error && data) {
      return {
        ...(data as Record<string, unknown>),
        student_type: (data as any).student_type ?? null,
      } as unknown as ScanCustomerPayload;
    }

    return null;
  }, []);

  const handleScanValue = useCallback(
    async (value: string) => {
      const normalized = value.trim();
      if (!normalized) {
        return;
      }
      if (resultResetTimerRef.current !== null) {
        window.clearTimeout(resultResetTimerRef.current);
        resultResetTimerRef.current = null;
      }
      setToast(null);

      const now = Date.now();
      const previous = lastScanRef.current;
      if (previous && previous.value.toLowerCase() === normalized.toLowerCase() && now - previous.at < SCAN_COOLDOWN_MS) {
        return;
      }
      lastScanRef.current = { value: normalized, at: now };
      setSelectedResourceId("");
      const scanHint = normalized.length > 4
        ? `${normalized.slice(0, 4)}...`
        : normalized;
      setLastScans((current) =>
        [{ value: scanHint, at: now }, ...current].slice(0, 10),
      );
      setManualCode("");

      try {
        setBusy(true);
        const client = getSupabaseClient();
        const { data, error } = await client.rpc("scan_customer", {
          p_input: normalized,
        });

        if (error) {
          throw error;
        }

        const payload = data as ScanResponse | null;
        const fullData = payload && payload.customer
          ? {
              ...payload,
              customer: {
                ...payload.customer,
                ...(await loadCustomerMeta(payload.customer.id)),
              },
            }
          : payload;

        setResult(fullData ?? null);

        if (fullData?.ok) {
          playAlert("success", muted);
        } else {
          playAlert("error", muted);
        }

        if (fullData?.ok) {
          await reloadResources();
          await refreshInsideNow();
        }
      } catch (error: unknown) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message?: string }).message)
            : "";

        setResult({
          ok: false,
          reason: "unknown",
          customer: undefined,
          checkin: null,
        });
        setToast({
          kind: "error",
          message: message || t("scan.errors.general"),
        });
        playAlert("error", muted);
      } finally {
        setBusy(false);
        setTimeout(() => {
          if (inputRef.current) inputRef.current.focus();
        }, 0);
      }
    },
    [loadCustomerMeta, muted, refreshInsideNow, reloadResources, t],
  );

  handleScanValueRef.current = handleScanValue;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    void refreshInsideNow();
  }, [refreshInsideNow]);

  useEffect(
    () => () => {
      if (resultResetTimerRef.current !== null) {
        window.clearTimeout(resultResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const client = getSupabaseClient();
    let timeout: number | null = null;
    const refreshFromRealtime = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        void refreshInsideNow();
        void reloadResources();
      }, 1000);
    };
    const channel = client.channel("scan-checkins-live");
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "checkins" },
      refreshFromRealtime,
    );
    void channel.subscribe();

    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      void client.removeChannel(channel);
    };
  }, [refreshInsideNow, reloadResources]);

  useEffect(() => {
    let disposed = false;

    const stopScanner = async (clear = true) => {
      const scanner = scannerRef.current;
      if (scanner && scannerRunningRef.current) {
        try {
          await scanner.stop();
        } catch {
          // stop() can reject when StrictMode already stopped it.
        }
        scannerRunningRef.current = false;
        setCameraRunning(false);
      }
      if (scanner && clear) {
        try {
          scanner.clear();
        } catch {
          // Clearing is safe after stop or a failed start.
        }
        if (scannerRef.current === scanner) scannerRef.current = null;
      }
    };
    stopScannerRef.current = () => stopScanner(true);

    const startScanner = async () => {
      if (
        disposed ||
        document.hidden ||
        testingCamera ||
        scannerRunningRef.current ||
        scannerStartingRef.current
      ) return;

      if (!window.isSecureContext) {
        setCameraError({ message: t("scan.camera.secureContext"), name: "SecurityError" });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError({ message: t("scan.camera.unsupported"), name: "MediaDevicesUnavailable" });
        return;
      }

      scannerStartingRef.current = true;
      try {
        const constraints: Array<Record<string, unknown>> = [
          ...(cameraDeviceId
            ? [{ deviceId: { exact: cameraDeviceId } }]
            : []),
          { facingMode: { ideal: "environment" } },
          { facingMode: { ideal: "user" } },
        ];

        let lastError: unknown = null;
        for (const constraint of constraints) {
          if (disposed || document.hidden) return;
          const previousScanner = scannerRef.current;
          if (previousScanner) {
            await stopScanner(true);
            if (disposed || document.hidden) return;
          }
          const scanner = new Html5Qrcode("scanner-reader");
          scannerRef.current = scanner;
          try {
            const startPromise = scanner.start(
              constraint,
              { fps: 12, qrbox: { width: 260, height: 260 } },
              async (decodedText) => {
                await handleScanValueRef.current(decodedText);
              },
              () => undefined,
            );
            await startPromise;
            scannerRunningRef.current = true;
            setCameraRunning(true);
            if (disposed) {
              await stopScanner(true);
              return;
            }
            setCameraError(null);
            void Html5Qrcode.getCameras()
              .then((devices) => {
                if (!disposed) setCameraDevices(devices);
              })
              .catch(() => undefined);
            return;
          } catch (error) {
            lastError = error;
            if (scanner.isScanning) {
              try {
                await scanner.stop();
              } catch {
                // A failed camera start may not have a stoppable stream.
              }
            }
            try {
              scanner.clear();
            } catch {
              // Clearing is safe after a failed start.
            }
            scannerRef.current = null;
          }
        }

        if (!disposed && !document.hidden) {
          try {
            const devices = await Html5Qrcode.getCameras();
            if (disposed) return;
            setCameraDevices(devices);
            for (const device of devices) {
              if (constraints.some((constraint) => {
                const id = (constraint.deviceId as { exact?: string } | undefined)?.exact;
                return id === device.id;
              })) continue;
              const scanner = new Html5Qrcode("scanner-reader");
              scannerRef.current = scanner;
              try {
                const startPromise = scanner.start(
                  { deviceId: { exact: device.id } },
                  { fps: 12, qrbox: { width: 260, height: 260 } },
                  async (decodedText) => {
                    await handleScanValueRef.current(decodedText);
                  },
                  () => undefined,
                );
                await startPromise;
                scannerRunningRef.current = true;
                setCameraRunning(true);
                setCameraError(null);
                return;
              } catch (error) {
                lastError = error;
                try {
                  if (scanner.isScanning) await scanner.stop();
                } catch {
                  // A failed camera start may not have a stoppable stream.
                }
                try {
                  scanner.clear();
                } catch {
                  // Clearing is safe after a failed start.
                }
                scannerRef.current = null;
              }
            }
          } catch {
            // The original startup error is more useful if device discovery fails.
          }
        }

        if (!disposed) {
          const errorDetails = getCameraError(lastError);
          setCameraError({
            message: t(errorDetails.key),
            name: errorDetails.name,
          });
        }
      } finally {
        scannerStartingRef.current = false;
      }
    };

    startScannerRef.current = () => {
      const task = startScanner();
      scannerLifecycleRef.current = task.catch(() => undefined);
    };
    const queueStop = () => {
      scannerLifecycleRef.current = scannerLifecycleRef.current
        .catch(() => undefined)
        .then(() => stopScanner(true));
    };
    const onVisibilityChange = () => {
      if (document.hidden) queueStop();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      startScannerRef.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      queueStop();
    };
  }, [cameraDeviceId, testingCamera, t]);

  const handleTestCamera = async () => {
    setTestingCamera(true);
    setCameraTestResult(null);
    let stream: MediaStream | null = null;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new DOMException("Secure camera access is unavailable", "SecurityError");
      }
      scannerLifecycleRef.current = scannerLifecycleRef.current
        .catch(() => undefined)
        .then(() => stopScannerRef.current());
      await scannerLifecycleRef.current;
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      testStreamRef.current = stream;
      if (!testVideoRef.current) throw new Error("Camera preview is unavailable");
      testVideoRef.current.srcObject = stream;
      await testVideoRef.current.play();
      setCameraTestResult({ success: true, message: t("scan.camera.testSuccess") });
      testTimerRef.current = window.setTimeout(() => {
        stream?.getTracks().forEach((track) => track.stop());
        testStreamRef.current = null;
        testTimerRef.current = null;
        if (testVideoRef.current) testVideoRef.current.srcObject = null;
        setTestingCamera(false);
      }, 3000);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      testStreamRef.current = null;
      if (testVideoRef.current) testVideoRef.current.srcObject = null;
      const details = getCameraError(error);
      setCameraTestResult({
        success: false,
        message: `${t(details.key)} (${details.name})`,
      });
      setTestingCamera(false);
    }
  };

  useEffect(
    () => () => {
      if (testTimerRef.current !== null) {
        window.clearTimeout(testTimerRef.current);
      }
      testStreamRef.current?.getTracks().forEach((track) => track.stop());
      testStreamRef.current = null;
    },
    [],
  );

  const handleManualSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manualCode.trim() || isSubmittingManual) return;
    setIsSubmittingManual(true);
    try {
      await handleScanValue(manualCode);
    } finally {
      setIsSubmittingManual(false);
      inputRef.current?.focus();
    }
  };

  const handleCheckIn = async () => {
    if (!result?.ok || result.checkin || !result.customer || actionBusy) return;

    setActionBusy("checkin");
    setToast(null);

    try {
      const client = getSupabaseClient();
      const { data, error } = await client.rpc("check_in", {
        p_customer: result.customer.id,
        p_resource: selectedResourceId || null,
      });

      if (error) throw error;
      setResult((current) =>
        current && current.customer?.id === result.customer?.id
          ? {
              ...current,
              checkin: {
                id: data.id,
                checked_in_at: data.checked_in_at,
                timer_started_at: data.timer_started_at,
                resource_id: data.resource_id,
                customer_id: data.customer_id,
              },
            }
          : current,
      );
      setToast({ kind: "success", message: t("scan.toast.checkedIn") });
      playAlert("success", muted);
      scheduleResultReset();
      await reloadResources();
      await refreshInsideNow();
    } catch (error: unknown) {
      const message = error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message)
        : "";
      setToast({ kind: "error", message: getFriendlyScanError(message, t) });
      playAlert("error", muted);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCheckOut = async () => {
    if (!result?.checkin || actionBusy) return;
    if (
      permissions.includes("orders.manage") &&
      permissions.includes("checkins.manage")
    ) {
      setCheckoutCheckinId(result.checkin.id);
      return;
    }

    setActionBusy("checkout");
    setToast(null);

    try {
      const client = getSupabaseClient();
      const { data, error } = await client.rpc("check_out", {
        p_checkin: result.checkin.id,
      });

      if (error) throw error;
      const feesDue = extractFeesDue(data);
      setToast({
        kind: "success",
        message: feesDue.amount > 0
          ? t("scan.toast.checkedOutWithFees", {
              amount: formatMoney(feesDue.amount, feesDue.currency, currentLocale),
            })
          : t("scan.toast.checkedOut"),
      });
      playAlert("success", muted);
      scheduleResultReset();
      await reloadResources();
      await refreshInsideNow();
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: string }).message)
          : "";

      setToast({ kind: "error", message: getFriendlyScanError(message, t) });
      playAlert("error", muted);
    } finally {
      setActionBusy(null);
    }
  };

  const handleInsideNowCheckOut = async (row: LiveInsideRow) => {
    if (actionBusy) return;
    if (
      permissions.includes("orders.manage") &&
      permissions.includes("checkins.manage")
    ) {
      setCheckoutCheckinId(Number(row.id));
      return;
    }
    setActionBusy("checkout");
    setToast(null);
    try {
      const { data, error } = await getSupabaseClient().rpc("check_out", {
        p_checkin: Number(row.id),
      });
      if (error) throw error;

      const feesDue = extractFeesDue(data);
      setToast({
        kind: "success",
        message:
          feesDue.amount > 0
            ? t("scan.toast.checkedOutWithFees", {
                amount: formatMoney(feesDue.amount, feesDue.currency, currentLocale),
              })
            : t("scan.toast.checkedOut"),
      });
      playAlert("success", muted);
      scheduleResultReset();
      await refreshInsideNow();
      await reloadResources();
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: string }).message)
          : "";
      setToast({
        kind: "error",
        message: getFriendlyScanError(message, t),
      });
      playAlert("error", muted);
    } finally {
      setActionBusy(null);
    }
  };

  const resultTitle =
    !result
      ? ""
      : result.ok
        ? t("scan.result.ok")
        : result.reason === "blocked"
          ? t("scan.result.blocked")
          : result.reason === "expired"
            ? t("scan.result.expired")
            : t("scan.result.unknown");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink dark:text-white">
            {t("pages.scan.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t("pages.scan.description")}
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          onClick={() => setMuted((current) => !current)}
          type="button"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          {muted ? t("scan.actions.unmute") : t("scan.actions.mute")}
        </button>
      </div>

      {toast && (
        <div
          className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <Camera size={16} />
                {t("scan.camera.title")}
              </div>
              {busy && (
                <div className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <LoaderCircle className="animate-spin" size={14} />
                  {t("scan.camera.scanning")}
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t("scan.camera.device")}
                </span>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  onChange={(event) => {
                    const deviceId = event.target.value;
                    setCameraDeviceId(deviceId);
                    if (deviceId) window.localStorage.setItem(CAMERA_DEVICE_STORAGE_KEY, deviceId);
                    else window.localStorage.removeItem(CAMERA_DEVICE_STORAGE_KEY);
                  }}
                  value={cameraDeviceId}
                >
                  <option value="">{t("scan.camera.auto")}</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.id} value={device.id}>
                      {device.label || `${t("scan.camera.cameraNumber")} ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={cameraRunning || testingCamera}
                onClick={() => startScannerRef.current()}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {cameraError ? t("scan.camera.retry") : t("scan.camera.open")}
              </button>
              <button
                type="button"
                disabled={testingCamera}
                onClick={() => void handleTestCamera()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60 dark:border-slate-700"
              >
                {testingCamera ? t("scan.camera.testing") : t("scan.camera.test")}
              </button>
            </div>

            <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-700">
              <div id="scanner-reader" className="h-full w-full" />
            </div>
            <video
              ref={testVideoRef}
              autoPlay
              muted
              playsInline
              className={`mt-3 aspect-video w-full rounded-xl bg-black ${testingCamera ? "block" : "hidden"}`}
            />
            {cameraTestResult && (
              <p className={`mt-2 text-sm ${cameraTestResult.success ? "text-emerald-600" : "text-red-600"}`}>
                {cameraTestResult.message}
              </p>
            )}

            {cameraError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <p>{cameraError.message}</p>
                {cameraError.name && (
                  <p className="mt-1 text-xs opacity-75">{cameraError.name}</p>
                )}
              </div>
            )}

            <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handleManualSubmit}>
              <label className="sr-only" htmlFor="manual-code">
                {t("scan.manual.label")}
              </label>
              <input
                id="manual-code"
                ref={inputRef}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base outline-none ring-0 focus:border-brand dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                onChange={(event) => setManualCode(event.target.value)}
                placeholder={t("scan.manual.placeholder")}
                value={manualCode}
              />
              <button
                className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                disabled={isSubmittingManual || !manualCode.trim()}
                type="submit"
              >
                {isSubmittingManual ? t("scan.actions.submitting") : t("scan.actions.submit")}
              </button>
            </form>
          </div>

          {result && (
            <div
              className={`rounded-2xl border p-5 ${
                result.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                  : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {result.ok ? (
                    <CheckCircle2 className="shrink-0" size={22} />
                  ) : (
                    <ShieldAlert className="shrink-0" size={22} />
                  )}
                  <div>
                    <h2 className="text-xl font-semibold">{resultTitle}</h2>
                    {!result.ok && (
                      <p className="mt-1 text-sm opacity-80">
                        {t(
                          result.reason === "blocked"
                            ? "scan.messages.blocked"
                            : result.reason === "expired"
                              ? "scan.messages.expired"
                              : "scan.messages.unknown",
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {result.ok && result.customer && (
                  <span className="rounded-full border border-current/30 px-2 py-1 text-xs font-semibold">
                    {t("scan.result.ok")}
                  </span>
                )}
              </div>

              {result.ok && result.customer && (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide opacity-75">
                      {t("scan.fields.name")}
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {`${result.customer.first_name} ${result.customer.last_name}`.trim()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide opacity-75">
                      {t("scan.fields.code")}
                    </p>
                    <p className="mt-1 font-mono text-base font-semibold">
                      {result.customer.code}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide opacity-75">
                      {t("scan.fields.birthDate")}
                    </p>
                    <p className="mt-1 text-base font-medium">
                      {formatBirthDate(result.customer.birth_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide opacity-75">
                      {t("scan.fields.studentType")}
                    </p>
                    <p className="mt-1 text-base font-medium">
                      {result.customer.student_type
                        ? getStudentTypeName(
                            result.customer.student_type,
                            i18n.language,
                          )
                        : t("scan.fields.unknownType")}
                    </p>
                  </div>
                </div>
              )}

              {result.ok && result.checkin?.checked_in_at && (
                <div className="mt-4 rounded-lg border border-current/20 bg-black/5 px-3 py-2 text-sm dark:bg-white/5">
                  <span className="font-semibold">{t("scan.status.alreadyInsideSince", { time: formatDateTime(result.checkin.checked_in_at, currentLocale) })}</span>
                </div>
              )}
              {result.ok && result.checkin && (
                <div className="mt-4">
                  <TimerWidget
                    checkinId={result.checkin.id}
                    enabled={permissions.includes("timers.view")}
                  />
                </div>
              )}

              {result.ok && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {!result.checkin?.id ? (
                    <>
                      <label className="min-w-[220px] flex-1">
                        <span className="mb-1 block text-xs uppercase tracking-wide opacity-75">
                          {t("scan.fields.resource")}
                        </span>
                        <select
                          className="w-full rounded-lg border border-current/25 bg-white/40 px-3 py-2 text-sm text-slate-900 outline-none dark:bg-slate-950/40 dark:text-white"
                          onChange={(event) => setSelectedResourceId(event.target.value)}
                          value={selectedResourceId}
                        >
                          <option value="">{t("scan.fields.noSpecificSeat")}</option>
                          {availableResources.map((resource) => (
                            <option key={resource.id} value={resource.id}>
                              {resource.name} ({resource.occupancy}/{resource.capacity})
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
                        disabled={actionBusy !== null}
                        onClick={() => void handleCheckIn()}
                        type="button"
                      >
                        {actionBusy === "checkin" ? (
                          <LoaderCircle className="animate-spin" size={16} />
                        ) : (
                          <DoorOpen size={16} />
                        )}
                        {t("scan.actions.checkIn")}
                      </button>
                    </>
                  ) : (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
                      disabled={actionBusy !== null}
                      onClick={() => void handleCheckOut()}
                      type="button"
                    >
                      {actionBusy === "checkout" ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : (
                        <DoorClosed size={16} />
                      )}
                      {t("scan.actions.checkOut")}
                    </button>
                  )}

                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-current/25 px-4 py-2.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      !result.checkin?.id ||
                      !permissions.includes("orders.create") &&
                      !permissions.includes("orders.manage")
                    }
                    onClick={() =>
                      navigate("/orders/new", {
                        state: {
                          customerId: result.customer?.id,
                          checkinId: result.checkin?.id,
                        },
                      })
                    }
                    type="button"
                  >
                    <ShoppingBasket size={16} />
                    {t("scan.actions.newOrder")}
                  </button>
                  {permissions.includes("feedback.add") && result.customer && (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-current/25 px-4 py-2.5 font-semibold"
                      onClick={() => setFeedbackCustomerId(result.customer?.id ?? null)}
                      type="button"
                    >
                      {t("quality.feedback.record")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-ink dark:text-white">
              {t("scan.sidePanels.insideNow")}
            </h3>
            {insideError && (
              <div
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                <p>{t("scan.errors.insideLoad")}</p>
                <button
                  className="mt-2 font-semibold underline"
                  onClick={() => void refreshInsideNow()}
                  type="button"
                >
                  {t("scan.camera.retry")}
                </button>
              </div>
            )}
            <div className="mt-4 space-y-3">
              {insideNow.length === 0 && !insideError ? (
                <p className="text-sm text-slate-500">{t("scan.empty.insideNow")}</p>
              ) : (
                insideNow.map((row) => {
                  const customerName = row.customer
                    ? `${row.customer.first_name} ${row.customer.last_name}`.trim()
                    : t("scan.fields.unknownCustomer");
                  const resourceName = row.resource?.name || t("scan.fields.noResource");
                  return (
                    <div
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950"
                      key={row.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-ink dark:text-white">{customerName}</p>
                          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                            {row.customer?.code ?? ""}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {resourceName} · {formatDateTime(row.checked_in_at, currentLocale)}
                          </p>
                        </div>
                        <button
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                          disabled={actionBusy !== null}
                          onClick={() => void handleInsideNowCheckOut(row)}
                          type="button"
                        >
                          {t("scan.actions.checkOut")}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-ink dark:text-white">
              {t("scan.sidePanels.lastScans")}
            </h3>
            <div className="mt-4 space-y-2">
              {lastScans.length === 0 ? (
                <p className="text-sm text-slate-500">{t("scan.empty.lastScans")}</p>
              ) : (
                lastScans.map((scan, index) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    key={`${scan.value}-${index}`}
                  >
                    <span className="font-mono">{scan.value}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(scan.at).toLocaleTimeString(currentLocale)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
      {checkoutCheckinId !== null && (
        <CheckoutDialog
          checkinId={checkoutCheckinId}
          onClose={() => setCheckoutCheckinId(null)}
          onComplete={(ticket: CheckoutTicket) => {
            setResult((current) =>
              current?.checkin?.id === ticket.checkin_id
                ? { ...current, checkin: null }
                : current,
            );
            setToast({
              kind: "success",
              message: t("scan.toast.checkoutPaid", {
                ticket: ticket.ticket_no,
                amount: formatMoney(ticket.total, ticket.currency, currentLocale),
              }),
            });
            scheduleResultReset();
            void refreshInsideNow();
            void reloadResources();
          }}
        />
      )}
      {feedbackCustomerId && (
        <CustomerFeedbackDialog
          customerId={feedbackCustomerId}
          onClose={() => setFeedbackCustomerId(null)}
        />
      )}
    </div>
  );
}
