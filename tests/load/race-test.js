import exec from "k6/execution";
import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const productionProjectUrl = "https://iwijqcqmqrzegbtpnjpe.supabase.co";
const winners = new Counter("race_winners");
const unexpectedResponses = new Counter("race_unexpected_responses");
const requestLatency = new Trend("race_request_duration", true);

export const options = {
  scenarios: {
    payment_race: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      maxDuration: "1m",
    },
    checkin_race: {
      executor: "per-vu-iterations",
      vus: 10,
      iterations: 1,
      startTime: "10s",
      maxDuration: "1m",
    },
  },
  thresholds: {
    "race_winners{race:payment}": ["count==1"],
    "race_winners{race:checkin}": ["count==1"],
    "race_unexpected_responses{race:payment}": ["count==0"],
    "race_unexpected_responses{race:checkin}": ["count==0"],
    race_request_duration: ["p(95)<500"],
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
  const missing = [
    "K6_ENV",
    "K6_SUPABASE_ANON_KEY",
    "K6_RACE_ORDER_ID",
    "K6_RACE_PAYMENT_CUSTOMER_ID",
    "K6_RACE_CHECKIN_CUSTOMER_ID",
  ].filter((name) => !__ENV[name]);
  if (__ENV.K6_ENV !== "staging" || missing.length ||
      !supabaseUrl || supabaseUrl === productionProjectUrl ||
      !staffTokens || staffTokens.length !== 10 ||
      staffTokens.some((token) => typeof token !== "string" || !token)) {
    exec.test.abort(
      `Staging-only race test configuration invalid; missing fields: ${missing.join(", ") || "none"}.`,
    );
  }
  if (new URL(supabaseUrl).protocol !== "https:") {
    exec.test.abort("Race testing requires an HTTPS staging database URL.");
  }
  return { supabaseUrl, staffTokens };
}

function raceRequest(data, race, rpc, args, token) {
  const response = http.post(
    `${data.supabaseUrl}/rest/v1/rpc/${rpc}`,
    JSON.stringify(args),
    {
      headers: {
        apikey: __ENV.K6_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      tags: { name: `race_${race}`, race },
    },
  );
  requestLatency.add(response.timings.duration, { race });
  const succeeded = response.status >= 200 && response.status < 300;
  if (succeeded) winners.add(1, { race });
  else if (response.status < 400 || response.status >= 500) {
    unexpectedResponses.add(1, { race });
  }
  check(response, {
    [`${race} request returns a success or business rejection`]: () =>
      succeeded || (response.status >= 400 && response.status < 500),
  });
}

export function payment_race(data) {
  const token = data.staffTokens[exec.vu.idInTest - 1];
  raceRequest(
    data,
    "payment",
    "collect_payment",
    {
      p_customer: __ENV.K6_RACE_PAYMENT_CUSTOMER_ID,
      p_order_ids: [__ENV.K6_RACE_ORDER_ID],
      p_fee_ids: [],
      p_method: "cash",
      p_amount_received: null,
      p_note: null,
    },
    token,
  );
}

export function checkin_race(data) {
  const token = data.staffTokens[exec.vu.idInTest - 11];
  raceRequest(
    data,
    "checkin",
    "check_in",
    {
      p_customer: __ENV.K6_RACE_CHECKIN_CUSTOMER_ID,
      p_resource: null,
    },
    token,
  );
}
