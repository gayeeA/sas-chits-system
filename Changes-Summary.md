# Changes Summary

## UI – Balance display
- Updated all places that showed **Due amount** to display **Remaining balance** (web DuesPage, MemberDetailPage, GroupDetailPage, mobile DuesScreen, CollectScreen, TodayScreen).
- Stats and export CSVs now use `current_balance`/`balance` as **Remaining balance**.
- Full outstanding totals remain available via separate stats or tooltips.

## README – Migrations
- Added migrations `016_financial_calculation_guards.sql`, `017_confirmed_member_interest_ledger.sql`, `018_interest_owner_notice_controls.sql`, `019_confirmed_duration_sealing_rules.sql` to the migration run list.

## Group Form – Sealing period
- Added numeric input **Sealing period (months)** stored in `rule_config.sealing_period_months` with validation.

## Interest entry
- Owner‑only UI for applying interest, recording rate, notice date/method/reference.
- Helper `calculateSimpleInterest360` uses a 360‑day year and starts interest the day after the instalment due date.

## Commission & GST
- Commission taken from discount pool confirmed in receipt text.
- GST placeholder kept disabled with a note “GST will be added after accountant approval”.

## Verification
- All tests (`npm test`) pass (19/19).
- Type‑check and production builds for web and mobile succeed.

You can open this file directly in the project folder to review the changes.
