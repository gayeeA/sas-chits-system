# Deployment readiness

## Before using live company records

- Back up the database, then apply migrations `002_admin_features.sql` through `012_multiple_tickets_per_member.sql` in order to the production Supabase project.
- Review Supabase Security Advisor and Performance Advisor. Confirm row-level security is enabled and sensible on every exposed table, and enable SSL enforcement.
- Keep public sign-up disabled. Test with owner, manager, and staff accounts. Never put a Supabase service-role key in either client.
- The phone app stores its sign-in session with Expo SecureStore. The shared database remains the source of truth; do not rely on phone storage as the only copy of company records.
- Download a backup before importing history and regularly afterward. Keep another copy somewhere controlled by the company. Free Supabase projects may pause after inactivity and do not include downloadable managed database backups; check the current plan limits before relying on it for live business data.
- First deploy with test members and payments. Verify totals, receipt numbers, roles, historical import, paper receipt entry, PDF/WhatsApp sharing, and backup recovery before entering live records.
- Test offline queued collection with the phone disconnected, then reconnect it and confirm exactly one receipt appears on the web. Test a cheque bounce and confirm the member ledger reverses. Test assigned and unassigned tickets with separate staff accounts.
- Test member/group management on both clients with the owner account, then confirm staff accounts do not see the owner-only management controls. Verify that tickets with existing financial or auction history cannot be reassigned or deleted.
- Receipt scan photos live in Supabase Storage, separately from database backups. Keep a protected copy of any images the company needs to retain long term; never make the scan bucket public.
- For private Android distribution, use an internal EAS APK build and share it directly with staff. Android can install a compatible APK without an app store listing. The website URL can be public while company pages still require staff sign-in.

The production Supabase project has not been connected or deployed from this repository. Apply the migrations there and complete this checklist before using live company records.
