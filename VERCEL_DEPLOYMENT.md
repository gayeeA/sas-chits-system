# Deploy the website to Vercel

This guide deploys the **React + Vite website** in `apps/web`. Vercel hosts the website files; Supabase separately provides the database, sign-in, and private receipt-photo storage. The mobile app is not deployed by these steps.

## Before connecting Vercel

1. Push this repository to a Git provider that Vercel can access.
2. Create or select the Supabase project that the website will use. This repository has no production Supabase project configured automatically.
3. In Supabase **SQL Editor**, apply `supabase/schema.sql` only to a new, empty project. On an existing project, make a backup first and apply only the unapplied migrations in order: `002_admin_features.sql`, `003_legacy_receipts.sql`, `004_member_followups.sql`, `005_field_ops.sql`, `006_offline_payments.sql`, then `007_receipt_scans.sql`.
4. Disable public account sign-up and create the company owner account. Confirm the RLS policies and keep the `receipt-scans` Storage bucket private.
5. Copy the Supabase **Project URL** and **anon/public key** from the project API settings. Do not use or expose a service-role key.

## Create the Vercel project

1. In Vercel, choose **Add New → Project**, import the repository, and open the project configuration before deploying.
2. Set **Root Directory** to `apps/web` and leave **Include files outside the Root Directory** disabled. The web app has its own `package.json` and does not need files from outside this folder to build.
3. Use these build settings:

   | Setting | Value |
   | --- | --- |
   | Framework Preset | Vite (or Other if Vite is not detected) |
   | Install Command | `npm install` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |

   The project already contains `apps/web/vercel.json`, which rewrites routes to the SPA entry point so paths such as `/dashboard` continue to work when opened directly or refreshed.

4. Add these environment variables under **Settings → Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | The Supabase project URL, for example `https://your-project.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | The Supabase anon/public key |

   These values are compiled into the browser bundle because Vite exposes `VITE_` variables to client code. The anon key is intended for client use; database security must come from correct Supabase RLS policies. Never add `SUPABASE_SERVICE_ROLE_KEY` or another privileged secret here.

5. For the first deployment, set the production Supabase values for **Production**. Only add them to **Preview** if preview deployments are intentionally allowed to use the same company database. Prefer a separate Supabase project for preview testing. A preview build with no Supabase variables will not be usable as an authenticated app.
6. Click **Deploy**. After it succeeds, open the generated `*.vercel.app` URL and confirm that the login page loads.

## Set Supabase Auth URLs

In the Supabase Dashboard, open **Authentication → URL Configuration**:

1. Set **Site URL** to the production website origin, for example `https://your-company.vercel.app` (or the custom domain after adding one).
2. Add the exact production origin to **Redirect URLs**. Add `http://localhost:5173/**` for local development if needed.
3. If password reset or email links should work on Vercel previews, add an appropriately scoped Vercel preview pattern. Supabase documents this format: `https://*-<team-or-account-slug>.vercel.app/**`. Keep the production Site URL set to the real production origin rather than a preview URL.

If a custom domain is added in Vercel, wait for Vercel to show it as configured with HTTPS, then update the Supabase Site URL and Redirect URLs to include that production domain. Keep the Vercel URL too if staff will continue using it.

## Verify before entering live records

- Open `/login`, sign in with the owner account, and verify the expected role and dashboard data.
- Directly open and refresh `/dashboard`, `/dues`, `/collect`, `/receipts`, and `/reports` to confirm SPA routing works.
- Check member search, a test payment and receipt, receipt image/PDF actions, exports, and private receipt scans.
- Confirm a staff account cannot access owner/manager-only actions and that Supabase RLS rejects unauthorized data access.
- Use test records first. Back up Supabase before importing old Excel or paper-receipt history, and reconcile totals before using live company data.

For a local production-build check, from PowerShell run:

```powershell
Set-Location .\apps\web
Copy-Item .env.example .env
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
npm install
npm run typecheck
npm run build
npm run preview
```

Vercel creates deployments from Git pushes. Check the latest deployment’s build log after changes to environment variables; those changes take effect on a new deployment. To roll back website code, promote a previous successful Vercel deployment. Database migrations are separate and are not rolled back by a website rollback.

## Project references

- Vercel [build configuration](https://vercel.com/docs/builds/configure-a-build), [monorepos](https://vercel.com/docs/monorepos), and [environment variables](https://vercel.com/docs/environment-variables).
- Supabase [Auth redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).
- Repository deployment readiness checklist: [`DEPLOYMENT.md`](./DEPLOYMENT.md).
