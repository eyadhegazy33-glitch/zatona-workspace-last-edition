import exec from "k6/execution";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const productionProjectUrl = "https://iwijqcqmqrzegbtpnjpe.supabase.co";
const errorRate = new Rate("workflow_error_rate");
const databaseLatency = new Trend("database_call_duration", true);
const scanCalls = new Counter("workflow_scans");
const timerCalls = new Counter("workflow_timer_reads");
const dashboardCalls = new Counter("workflow_dashboard_reads");
const ordersCreated = new Counter("workflow_orders_created");
const receiptsIssued = new Counter("workflow_receipts_issued");

export const options = {
  scenarios: {
    staff_workflow: {
      executor: "constant-vus",
      vus: 30,
      duration: "10m",
    },
  },
  thresholds: {
    workflow_error_rate: ["rate<0.01"],
    database_call_duration: ["p(95)<500"],
  },
};

function parseJsonEnv(name) {
  try {
    const value = JSON.parse(__ENV[name] || "");
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function setup() {
  const supabaseUrl = (__ENV.K6_SUPABASE_URL || "").replace(/\/+$/, "");
  const staffTokens = parseJsonEnv("K6_STAFF_TOKENS");
  const required = [
    "K6_ENV",
    "K6_BASE_URL",
    "K6_SUPABASE_ANON_KEY",
    "K6_CUSTOMER_ID",
    "K6_CHECKIN_ID",
    "K6_CUSTOMER_CODE",
    "K6_PRODUCT_ID",
  ];
  const missing = required.filter((name) => !__ENV[name]);
  if (__ENV.K6_ENV !== "staging" || missing.length || !supabaseUrl ||
      supabaseUrl === productionProjectUrl ||
      !staffTokens || staffTokens.length !== 30 ||
      staffTokens.some((token) => typeof token !== "string" || !token)) {
    exec.test.abort(
      `Staging-only load test configuration invalid; missing fields: ${missing.join(", ") || "none"}.`,
    );
  }
  const appUrl = new URL(__ENV.K6_BASE_URL);
  const apiUrl = new URL(supabaseUrl);
  if (appUrl.protocol !== "https:" || apiUrl.protocol !== "https:" ||
      appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1" ||
      apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1") {
    exec.test.abort("Load testing requires public HTTPS staging endpoints.");
  }
  return { supabaseUrl, staffTokens };
}

function rpc(data, name, args, token) {
  const response = http.post(
    `${data.supabaseUrl}/rest/v1/rpc/${name}`,
    JSON.stringify(args),
    {
      headers: {
        apikey: __ENV.K6_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      tags: { name: `rpc_${name}`, operation: name },
    },
  );
  databaseLatency.add(response.timings.duration, { operation: name });
  const ok = check(response, {
    [`${name} succeeds`]: (result) =>
      result.status >= 200 && result.status < 300,
  });
  errorRate.add(!ok, { operation: name });
  return ok ? response : null;
}

export default function (data) {
  try {
    const token = data.staffTokens[(exec.vu.idInTest - 1) % data.staffTokens.length];
    const scan = rpc(data, "scan_customer", { p_input: __ENV.K6_CUSTOMER_CODE }, token);
    if (!scan) return;
    scanCalls.add(1);

    const timers = rpc(data, "get_live_timers", {}, token);
    if (!timers) return;
    timerCalls.add(1);

    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const dashboard = rpc(
      data,
      "dashboard_summary",
      { p_from: start, p_to: now.toISOString() },
      token,
    );
    if (!dashboard) return;
    dashboardCalls.add(1);

    const created = rpc(
      data,
      "create_pos_order",
      {
        p_customer: __ENV.K6_CUSTOMER_ID,
        p_checkin: Number(__ENV.K6_CHECKIN_ID),
        p_items: [{ product_id: __ENV.K6_PRODUCT_ID, quantity: 1 }],
        p_discount_type: null,
        p_discount_value: 0,
        p_discount_reason: null,
      },
      token,
    );
    if (!created) return;

    let order;
    try {
      order = created.json();
    } catch {
      errorRate.add(true, { operation: "parse_create_pos_order" });
      return;
    }
    if (!order || typeof order.order_id !== "string") {
      errorRate.add(true, { operation: "parse_create_pos_order" });
      return;
    }
    ordersCreated.add(1);

    for (const status of ["preparing", "ready", "served"]) {
      if (!rpc(data, "set_pos_order_status", {
        p_order: order.order_id,
        p_status: status,
      }, token)) return;
    }

    const receipt = rpc(
      data,
      "complete_pos_order",
      { p_order: order.order_id, p_payment_method: "cash" },
      token,
    );
    if (!receipt) return;
    receiptsIssued.add(1);
  } finally {
    sleep(30);
  }
}
