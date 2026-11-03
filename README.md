# Zatona

## Cloudflare Pages deployment

This is a static Vite application. Connect the GitHub repository
`eyadhegazy33-glitch/zatona-workspace-last-edition` to Cloudflare Pages with:

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Build environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

Set the production variables in the Cloudflare Pages project settings before the
first build. These `VITE_` values are included in browser assets; use only the
Supabase project URL and publishable/anon key. Never set or expose a
`service_role` key. For preview deployments, use a staging Supabase project and
staging publishable/anon key rather than production credentials.

The `public/_headers` and `public/_redirects` files are copied to the build
output. They set the browser security headers and Content Security Policy and
route client-side pages to the React app. Supabase row-level security and SQL
function permissions remain required; hosting headers do not replace them.

## Automated tests

- `npm test` runs the Vitest unit tests with fake input data.
- Start the local Supabase stack, then run `npm run test:db` for the pgTAP database checks.
- `npm run test:e2e` is restricted to staging. Set `E2E_ENV=staging` and `E2E_BASE_URL` before supplying any test-account credentials. Do not point it at production.

Playwright role tests read `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, `E2E_MANAGER_EMAIL` / `E2E_MANAGER_PASSWORD`, `E2E_RECEPTION_EMAIL` / `E2E_RECEPTION_PASSWORD`, and `E2E_BARISTA_EMAIL` / `E2E_BARISTA_PASSWORD` from the environment. The registration approval test requires the staging Admin account. The POS workflow also requires `E2E_CUSTOMER_CODE` and `E2E_PRODUCT_NAME_EN` for fake staging fixtures.

For a local Vite server connected to a staging Supabase project, set `E2E_BASE_URL=http://127.0.0.1:5173` and provide `E2E_SUPABASE_URL` and `E2E_SUPABASE_ANON_KEY`; these override the app's Supabase settings for the test server. E2E flows can create persistent fake records, so use a disposable staging project and fake-only fixtures.
