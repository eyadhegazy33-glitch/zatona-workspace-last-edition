# Project rules for Zatona

Zatona is a workspace management system (staff roles, customers with QR cards, orders, 3-hour timer, receipts).
Stack: Vite, React, TypeScript, Tailwind CSS, React Router, React Hook Form, Zod, Supabase.

Security rules (never break these):
- Never trust the browser for permissions, prices, timers, or roles. All of that is enforced in Supabase (RLS and SQL functions).
- Never put the Supabase service_role key in frontend code. Only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are allowed in the frontend.
- The register form must NEVER let a user pick their real role. The chosen role is only a REQUEST (requested_role_id). A manager or admin approves it.
- Never delete rows that affect history (profiles, receipts, logs). Use soft delete (deleted_at).
- Do not change files inside /supabase/migrations after they were applied. Add a new migration instead.

Code rules:
- TypeScript strict mode. No "any".
- Validate every form with Zod.
- Every page must work on phone, tablet and desktop.
- All visible text must come from translation files (Arabic and English), never hard-coded.
- Support RTL (Arabic) and LTR (English), and light and dark mode.
- Keep components small. Put Supabase calls in /src/lib or /src/services, not inside UI components.
- Show friendly error messages. Never show raw database errors to the user.

Phase 2 rules:
- Customer personal data (birth date, phone, name) is private. Never log it with console.log, never put it in URLs, never send it to third-party services.
- The QR code contains ONLY the customer's secret qr_token. It never contains a name, a birth date, or a phone number.
- The browser never decides who may enter. Entry is decided by the SQL function scan_customer and check_in.
- Writing to customers, checkins, imports must go through the SQL functions (RPC), not direct table inserts or updates.
- Printing cards uses HTML + print CSS (so Arabic text prints correctly), not jsPDF text.