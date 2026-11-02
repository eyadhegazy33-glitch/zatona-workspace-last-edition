# Phase 5 database security checks

Snapshot recorded: 2026-11-03 00:42 EET
Project: `zatona` (`iwijqcqmqrzegbtpnjpe`)
Target status: **Production snapshot only. Staging does not exist in the available Supabase projects.**

The six read-only SQL checks requested for staging were run against the only available project, production. This is not a staging result and must not be used to claim staging validation. No database changes were made. Run the same checks against a staging database and repeat them against production immediately before go-live.

## Results

### 1. Public tables without RLS

Expected: no rows.
Actual: **no rows**.

```sql
select schemaname, tablename
from pg_tables
where schemaname = 'public' and not rowsecurity;
```

### 2. Anon-executable `SECURITY DEFINER` functions

Expected: no unexpected rows.
Actual: **13 rows**:

```text
has_permission(text)
handle_new_user()
approve_account(uuid,uuid)
reject_account(uuid,text)
scan_public_card(text)
restore_timer_fee_when_receipt_voided()
customer_loyalty_login(text,text,text)
get_customer_loyalty_portal(text)
request_customer_loyalty_reward(text,uuid)
customer_loyalty_logout(text)
incident_after_insert()
alert_after_insert()
audit_enrich()
```

The trigger-only functions (`handle_new_user`, `restore_timer_fee_when_receipt_voided`, `incident_after_insert`, `alert_after_insert`, `audit_enrich`) and the permission helper should not be directly executable by `anon`. The approval/rejection RPCs should also be reviewed for authenticated-only grants. Public card scanning and customer loyalty portal RPCs appear intentionally public-facing and require individual product/security review; do not revoke them without verifying their intended anonymous flows.

No grant changes were applied because only production is available. The suggested `REVOKE`/`GRANT` statements need staging validation first. `audit_row()` was not in the query result.

### 3. `SECURITY DEFINER` functions without fixed `search_path`

Expected: no rows.
Actual: **no rows**.

### 4. Direct-write public policies

Expected: only explicitly allowed feature policies.
Actual:

| Table | Policy | Command | Assessment |
|---|---|---|---|
| `notifications` | `notifications_mark_read` | UPDATE | Additional policy beyond the stated allowlist. It is scoped to the user's own row (`user_id = auth.uid()`) for both `USING` and `WITH CHECK`; confirm this intentional exception. |
| `pos_menu_categories` | `pos_menu_categories_admin_insert` | INSERT | Menu-management policy. |
| `pos_menu_categories` | `pos_menu_categories_admin_update` | UPDATE | Menu-management policy. |
| `pos_products` | `pos_products_admin_insert` | INSERT | Menu-management policy. |
| `pos_products` | `pos_products_admin_update` | UPDATE | Menu-management policy. |
| `qc_template_items` | `qc_items_write` | ALL | QC template-management policy. |
| `qc_templates` | `qc_templates_write` | ALL | QC template-management policy. |
| `resources` | `resources_write` | ALL | Resource-management policy. |
| `shift_assignments` | `assignments_manage_write` | ALL | Shift-management policy. |
| `shifts` | `shifts_manage_write` | ALL | Shift-management policy. |

No direct-write policies were returned for inventory, bookings, incidents, incident events, submissions, answers, feedback, alerts, or audit logs.

### 5. Policies visible to `anon`

Expected: registrable roles only.
Actual:

| Table | Policy | Predicate | Assessment |
|---|---|---|---|
| `roles` | `roles_anon_read` | `is_registrable` | Matches expectation. |
| `settings` | `settings_public_read` | Only `workspace_name`, `logo_url`, `primary_color`, `secondary_color` | Additional public policy; narrowly limited to public branding settings, but does not match the stated “roles only” expectation. |

### 6. Scheduled jobs

Expected: `zatona-timer`, `zatona-alerts`, `zatona-bookings`.
Actual:

| Job | Schedule | Active |
|---|---|---|
| `zatona-alerts` | `* * * * *` | Yes |
| `zatona-bookings` | `*/5 * * * *` | Yes |
| `zatona-timer` | `* * * * *` | Yes |

## Supabase Advisor snapshot

Advisor data was observed at `2026-11-02T22:41:36Z` (2026-11-03 00:41:36 EET). The Advisor API reports `WARN` rather than a separate `HIGH` severity. Consequently, these warnings are listed as outstanding and are not represented as cleared.

### Security warnings (`WARN`)

- `extension_in_public` (1): `btree_gist` is installed in `public`. Do not relocate without checking extension dependencies, including the booking overlap constraint.
- `anon_security_definer_function_executable` (13): the functions listed in check 2. Some anonymous RPCs are intentional product surfaces; trigger helpers and the permission helper are not intended RPCs.
- `authenticated_security_definer_function_executable` (140): authenticated roles can call security-definer RPCs. The linter flags exposure generically; each function's permission checks and intended API surface must be reviewed before accepting or changing grants.
- `auth_leaked_password_protection` (1): Supabase Auth leaked-password protection is disabled. This is an Auth dashboard setting, not a SQL migration.

### Performance warnings (`WARN`)

- `auth_rls_initplan` (10): policies repeatedly evaluate auth/current-setting expressions per row. Advisor recommends wrapping auth calls in `SELECT` where semantics remain identical.
- `multiple_permissive_policies` (11): overlapping permissive policies. They can add policy-evaluation cost; merge only after preserving the exact access rules.

The Advisor snapshot also reported informational findings, including 14 RLS-enabled tables with no policies and 12 unused indexes. RLS with no policy is default-deny; do not add policies solely to silence that advisory.

## Follow-up required

1. Provide/configure an isolated staging Supabase project, then rerun all six checks and review the Advisor findings there.
2. On staging, revoke anonymous/public execution from helper/trigger-only functions and `has_permission`, then rerun check 2. Keep intended public-facing RPCs only after verifying their validation and rate limits.
3. Decide whether the own-row notification update and public branding settings are accepted exceptions to the stated policy allowlists.
4. Review the 140 authenticated security-definer RPCs and the performance warnings without weakening permissions.
5. Before go-live, rerun the six SQL checks and Advisor review on production and save a separate dated snapshot.
