# Sri AndeSivaiah Chits: collection & receipt system

This is a Khata-book-style collection and ledger system for Sri AndeSivaiah Chits Pvt. Ltd. The website is for the office computer and the Expo app is for the phone. Both clients use the same Supabase project, so customer, group, installment, payment and receipt data are shared.

The current foundation is React + Vite web, Expo React Native mobile, shared TypeScript accounting helpers, and Supabase PostgreSQL/Auth/RLS. The company receipt layout and visiting-card colors/logo are retained. Use a Supabase free project for a pilot only; check provider limits and maintain backups before relying on it for business records.

## What the system does (admin / owner only)

This is an office tool for the chit-fund owner and staff only. Members (customers) never log in; there is no customer-side app.

| Web route | Screen | Purpose |
| --- | --- | --- |
| `/` | Introduction | Public page with a login button |
| `/login` | Sign in | Supabase email/password sign-in |
| `/dashboard` | Dashboard | This month's expected/collected/pending/overdue, today's collection by mode, this month's auctions, upcoming dates, alerts, recent payments |
| `/collect` | Record Payment | Find a member/ticket, see previous + current + total dues, record Cash / UPI / Bank Transfer / Cheque, print or share receipt images; today's collection summary |
| `/dues` | Dues & Follow-up | Member-wise outstanding and month-wise status, filters, Call and Chat reminder buttons, CSV export |
| `/groups`, `/groups/:id` | Chit Groups | Create/edit groups and their rules, tickets, month-by-month ledger, auction history; owners can bulk-remove tickets without linked history and prepare one combined WhatsApp reminder listing selected members |
| `/members`, `/members/:id` | Members | Add/edit/deactivate members (ID, phone, address, PAN, ID reference, nominee), **bulk import from Excel/CSV** (template and row-by-row check), merge duplicate member records while preserving their group tickets/history, bulk-delete members without group-ticket history, assign to groups, instalment/payment/lift history |
| `/auctions` | Auctions / Lifts | Record bids, winner, discount, commission and dividend with the calculation shown step by step |
| `/payouts` | Payouts | Winners waiting for payment, payout with verified deductions, printable voucher, history, and paid/unpaid prize-money reports |
| `/receipts` | Receipts | Receipt register with filters; owner cancels with a reason (never deletes) |
| `/reports` | Reports (manager) | Month/week/day summary, collection (all or Cash/UPI/Bank/Cheque), group-wise, member payments, pending dues, defaulters, auctions, payouts, group summary, income vs expenses. Quick periods (this week, last month, financial year…). Excel, Word and print/PDF, plus a one-click “Everything” Excel workbook |
| `/expenses` | Expenses (manager) | Office expenses and other income, kept separate from collections |
| `/settings` | Settings | Password, users & roles (owner), change history (manager), full backup download (owner) |

The website works on a phone too (bottom quick bar). On Android Chrome use **⋮ → Add to Home screen** to open it like an app.

The Expo phone app (field collection) has: Home summary, Dues list with Call/Chat reminder and shared follow-up notes, Collect (4 modes, receipt image and PDF sharing), and Today's collection (cash-in-hand by mode, re-share receipts). Owners and managers can also enter a paper receipt from the phone. The owner can manage members, group tickets, and empty-group deletion from **Manage members & groups**.

Ticket reassignment and member/group deletion are owner-only on both clients. A member may hold multiple tickets in the same group, but each ticket number remains unique within its group; withdrawn tickets remain as history. Reassignment is allowed only before financial, auction, or follow-up history exists; members and groups with linked records must be marked inactive/withdrawn or paused/completed instead of being deleted.

### Roles

| Role | Can do |
| --- | --- |
| Owner | Everything, including cancelling receipts/payouts/expenses, user roles and backups |
| Manager | Members, groups, collections, auctions, payouts, expenses, reports, change history |
| Staff (`clerk`/`agent`) | Record payments, add members, view groups, dues and receipts |

Permissions are enforced in the database (row-level security), not only hidden in the screens.

## First-time setup

### 1. Supabase PostgreSQL project

1. Create a Supabase project and copy its **Project URL** and **anon/public key** from Project Settings > API.
2. In the Supabase Dashboard, open **SQL Editor**. On a fresh project, paste `supabase/schema.sql` and click **Run**.
3. **Required:** In a new SQL Editor query, paste all of `supabase/migrations/002_admin_features.sql` and click **Run**. The website and mobile app use objects added by this migration, including `member_outstanding`, `installment_status`, `dashboard_summary`, payouts, expenses, and audit logs. If the base schema was installed earlier, run this migration now. If financial records already exist, make a database backup first.
4. Run `supabase/migrations/003_legacy_receipts.sql` after migration 002. It adds protected paper-receipt source details and the historical-payment RPC used by the website and phone.
5. Run `supabase/migrations/004_member_followups.sql` after migration 003. It adds the shared call/visit/reminder log used by the phone and website.
6. Run migrations `005_field_ops.sql`, `006_offline_payments.sql`, `007_receipt_scans.sql`, `008_legacy_receipt_adjustments.sql`, `009_owner_member_group_management.sql`, `010_bulk_member_delete.sql`, `011_merge_duplicate_members.sql`, `012_multiple_tickets_per_member.sql`, `013_auction_and_ticket_edits.sql`, `014_dues_display_breakdown.sql`, `015_auction_dividends_fifo_advances.sql`, `016_financial_calculation_guards.sql`, `017_confirmed_member_interest_ledger.sql`, `018_interest_owner_notice_controls.sql`, and `019_confirmed_duration_sealing_rules.sql` in order. They add collector assignments and cheque clearance, duplicate-safe mobile payment retries, private receipt photos, BP/agent commission adjustment fields for paper receipts, owner-only member/group deletion and ticket reassignment safeguards, atomic bulk member deletion plus group ticket-number limits, safe merging of duplicate member records, support for multiple tickets per member, safe auction editing/deletion and ticket-number changes, per-ticket dues breakdowns, agreement-configured dividend validation, FIFO allocation to due instalments, explicit advance-credit recording, payout-term validation, separate reporting of cash received versus subscription allocations, an auditable interest ledger with owner approval and notice controls, and the confirmed duration-based ticket count and sealing-period checks.
7. In Authentication settings, disable public sign-up. Create the owner's account first; the database's signup trigger makes the first profile the owner.
8. Keep the URL and anon key for both apps. Never put a service-role key in either client.

The schema is a fresh-install script, not a migration. Do not run it again on a project that already contains business or financial records. Back up an existing database in Supabase before applying migrations.

Migrations 015–019 do not recalculate historic auction, instalment, receipt, payout, or allocation amounts. Migration 015 validates new auction dividends and keeps payment surpluses as explicit advances. Migration 016 validates new payouts, corrects FIFO due-date allocation, and exposes subscription allocations separately from cash receipts. Migrations 017–018 add an auditable interest ledger; only the owner may apply or reverse interest, and notice details are required. Interest remains a separately recorded charge and is not yet automatically assessed or included in subscription receipts. Migration 019 aligns each group's configured ticket count to its duration, fixes commission treatment to the discount pool, and enforces the configured sealing period for new auction records. It refuses to run if an existing ticket number exceeds its group's duration. Apply migrations only after a database backup and review any reported precondition errors.

   The migration also fixes a bug in `schema.sql`: cancelling a receipt always failed with "Receipts are immutable", because the generated `total` column is not available inside the guard trigger.

### 2. Web app commands (PowerShell)

From the repository root:

```powershell
Set-Location .\apps\web
Copy-Item .env.example .env
```

Edit `apps/web/.env` and set:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Then run:

```powershell
npm install
npm run dev
```

Vite prints the local URL (usually `http://localhost:5173`). Other web commands:

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

For Vercel, import the repository, set the root/build configuration to `apps/web`, and add the two `VITE_SUPABASE_*` environment variables. Follow the [Vercel website deployment guide](./VERCEL_DEPLOYMENT.md) for the full setup and launch checklist. The SPA route fallback is configured in `apps/web/vercel.json`.

### 3. Mobile app commands (PowerShell)

From the repository root:

```powershell
Set-Location .\apps\mobile
Copy-Item .env.example .env
```

Edit `apps/mobile/.env` and set:

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Then run:

```powershell
npm install
npm run typecheck
npm run start
```

Install **Expo Go** on the phone and scan the Expo QR code. To start Expo for an Android emulator/device connected to the computer:

```powershell
npm run android
```

This project uses **Expo SDK 58**. If Expo Go reports an SDK mismatch, stop any old Expo server with `Ctrl+C`, ensure you are in `apps\mobile`, and restart with a cleared cache:

```powershell
npx expo start --clear
```

Then scan the newly generated QR code. Make sure the QR code is from this mobile project, not an older server or a different project folder.

To create an Android preview APK with EAS, configure/login to Expo first, then run:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

For a private installable APK that you can copy from the laptop to Android phones without publishing to an app store, follow the [Android app deployment guide](./ANDROID_APP_DEPLOYMENT.md). It includes the EAS project setup and Supabase environment variables required by the build.

### 4. Sync shared TypeScript

Edit the canonical money and receipt helpers in `packages/shared/src/chit.ts`. From the repository root, copy them into the web and mobile app sources:

```powershell
npm run sync
```

## Database tooling: Supabase PostgreSQL vs SQL Server

This application uses **Supabase PostgreSQL**, not Microsoft SQL Server. Supabase SQL includes PostgreSQL features such as `jsonb`, PL/pgSQL functions, and `auth.uid()`. The Visual Studio Code SQL Server extension and SQL Database Projects/DacFx tooling target SQL Server/T-SQL and cannot execute or publish this schema to Supabase.

Run `supabase/schema.sql` in the Supabase Dashboard's **SQL Editor** (or manage PostgreSQL migrations with the Supabase CLI). A separate SQL Server install/database remains separate and is not connected to this app. Do not change the database provider or try to run this file against SQL Server.

## Accounting and safety notes

- Money stored in the database is integer paise.
- New auction dividends are validated from the configured chit amount, commission rate, discount, and ticket count. The historical ₹10 lakh schedule's 40-ticket arithmetic is covered by tests; each group's configured terms remain the source of its calculation.
- Each group configures its own prized-member instalment rule, grace period, penalty, and dividend-forfeiture rule. New installments snapshot the rules; changing group settings does not rewrite old installments.
- A duplicate auction for a group/month and a repeat winner in a group are rejected by the database.
- `record_payment` creates the immutable receipt and its installment allocations in a single database transaction. `payment_quote` returns the configured dues and penalty preview.
- Financial history is not deleted. Owner cancellation requires a reason and appends allocation reversals.

## Free-tier hosting (no cost)

- **Database/login:** Supabase free plan. It pauses after 7 days without use (open the dashboard and click Restore) and has no downloadable daily backups — download a backup from Settings at least weekly (the dashboard reminds the owner).
- **Website:** Vercel or Netlify free plan (`apps/web`, build `npm run build`, output `dist`, add the two `VITE_SUPABASE_*` variables).
- **Phone app:** Expo Go (free) for daily use, or a free EAS preview APK build.
- **Reminders:** Chat and Call buttons use normal `wa.me` / `tel:` links from the owner's phone — no paid SMS/chat API.

## Confirmed group settings and remaining limitations

The confirmed company rules are applied to new activity, and the auction screen shows the calculation before saving:

- Commission is taken from the **bid discount** (reduces the dividend pool), not deducted again from the winner's payout.
- Total tickets equal the group duration in months. Migration 019 aligns configured counts and prevents a mismatch; it does not add or delete member tickets.
- The owner chooses each group's sealing-period length. Instalments remain within the total group duration; auctions begin after that period, and a draw winner can be recorded when there is no bidder.
- Dividend per ticket is (discount − commission) ÷ tickets, rounded down to the rupee, as demonstrated by the historical schedule.
- Prized member instalment: "net" or "full instalment in the month they lift". The full-instalment rule currently applies only to the month of the lift (as in the original design); if the agreement says prized members pay the full instalment for all later months, that needs a change.
- Penalty, grace days and dividend forfeiture.
- Auction terms can be corrected while no payout or collection is linked; otherwise only auction date and notes remain editable. Auction deletion is blocked when financial history exists. Receipts and payouts are cancelled with a reason and re-entered. Every change is in Settings → Change history.
- Interest remains an owner-approved, separately recorded charge. Automatic calculation after grace and adding it to subscription receipts are not implemented until a complete collection rule is confirmed.
- GST remains excluded from payout calculations until its taxable base, accounting treatment, and accountant-approved basis are confirmed; no tax deduction is inferred from chit value alone.

## Current verification and limitations

From `apps/web`: `npm run typecheck`, `npm test`, and `npm run build`. From `apps/mobile`: `npm run typecheck`. Apply/test the SQL against a fresh Supabase project, reconcile against the company's Excel, and test printing/sharing on the actual phone before using for live collections.

Historical payment import from Excel is available under Receipts for owners/managers. Map the spreadsheet columns and review the preview before recording rows. Each imported payment updates the same ledger as a current payment and retains the paper receipt number/book as source metadata. Historical payments require an existing membership and installment month; import old groups/auctions and generate their installments before importing payments. Failed rows are reported; successful rows remain saved and must not be imported again.

Owners/managers can enter an already-written paper receipt from Receipts on the website or from the phone app. Enter the original date, installment month, amount, method, and optional paper receipt number/book. The database rejects a repeated paper receipt number within the same book. The generated system receipt number remains separate. The web app can OCR receipt photos to suggest text, and the phone app can attach a private photo; always verify OCR against the source because handwritten text may be recognized poorly. Incoming cheque clearance is tracked; a bounced cheque cancels and reverses its receipt. Managers assign tickets to collectors; staff see assigned tickets in Dues. The phone caches up to 250 assigned tickets securely and can queue up to 20 payments while offline. Queued payments receive a system receipt only after the server syncs them.

### Importing members from Excel

Members → **Import from Excel** (owner/manager). Download the template or use your own sheet: the first row must be the column names. Common names like “Member Name”, “Mobile No.”, “Chit” and “Tkt No” are matched automatically and can be changed. Only the name is required; fill *Group code* + *Ticket no* to put the member into an existing group. Every row is checked before saving: missing names, taken tickets and unknown groups are blocked, phone numbers already in the system are skipped by default, and full Aadhaar numbers are shortened to the last 4 digits.
