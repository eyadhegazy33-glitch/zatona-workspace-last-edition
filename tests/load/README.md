# Staging performance tests

These scripts create orders and receipts and write scan/check-in records. Run them
only against a disposable staging project with fake customers, products, staff,
an open visit, and an open shift for each test account. The application and
Supabase endpoints must both be staging HTTPS URLs.

The scripts reject production's Supabase project URL and require
`K6_ENV=staging`. Keep all access tokens and keys in environment variables; do
not commit or print them.

## 30-user workflow

Set `K6_BASE_URL`, `K6_SUPABASE_URL`, `K6_SUPABASE_ANON_KEY`,
`K6_CUSTOMER_ID`, `K6_CHECKIN_ID`, `K6_CUSTOMER_CODE`, `K6_PRODUCT_ID`, and
`K6_STAFF_TOKENS` (a JSON array of 30 staging access tokens). Each account must
be a fake staff account with scanner, dashboard, order-management, and payment
permissions, plus an open POS shift if required by staging settings.

```sh
K6_ENV=staging k6 run tests/load/staff-workflow.js
```

Configure the other values in the shell environment before running.
Each virtual user waits 30 seconds between end-to-end workflows. This limits
staging writes to roughly 600 orders/receipts over the requested 10-minute run.
The summary reports operation latency, errors, and p95; the configured p95
threshold is 500 ms.

## Payment and check-in races

Prepare a single unpaid order with the matching payment-customer ID, plus a
different active customer who is not checked in. Set `K6_STAFF_TOKENS` to 10
fake staging access tokens with payment and check-in permissions, and set
`K6_RACE_ORDER_ID`, `K6_RACE_PAYMENT_CUSTOMER_ID`, and
`K6_RACE_CHECKIN_CUSTOMER_ID`.

```sh
K6_ENV=staging k6 run tests/load/race-test.js
```

Each race requires exactly one successful request and no server/network errors.
The nine expected business rejections are not counted as test errors.
