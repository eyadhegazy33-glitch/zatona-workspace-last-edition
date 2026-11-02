# Zatona

## Automated tests

- `npm test` runs the Vitest unit tests with fake input data.
- Start the local Supabase stack, then run `npm run test:db` for the pgTAP database checks.
- `npm run test:e2e` is restricted to staging. Set `E2E_ENV=staging` and `E2E_BASE_URL` before supplying any test-account credentials. Do not point it at production.

Playwright role tests read `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, `E2E_MANAGER_EMAIL` / `E2E_MANAGER_PASSWORD`, `E2E_RECEPTION_EMAIL` / `E2E_RECEPTION_PASSWORD`, and `E2E_BARISTA_EMAIL` / `E2E_BARISTA_PASSWORD` from the environment. The registration approval test requires the staging Admin account. The POS workflow also requires `E2E_CUSTOMER_CODE` and `E2E_PRODUCT_NAME_EN` for fake staging fixtures.

For a local Vite server connected to a staging Supabase project, set `E2E_BASE_URL=http://127.0.0.1:5173` and provide `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY`; these override the app's Supabase settings for the test server. E2E flows can create persistent fake records, so use a disposable staging project and fake-only fixtures.
