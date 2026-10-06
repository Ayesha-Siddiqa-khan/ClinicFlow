# ClinicFlow Runbook

## Prerequisites

- Node.js 24+
- A Supabase project (URL + anon key from Project Settings → API)
- Supabase CLI logged in (`supabase login`)

## Local setup

```bash
npm ci
cp .env.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Create the first doctor account in Supabase → Authentication → Users → Add user,
then sign in at `http://localhost:3000/login`.

## Database migrations

Schema lives in `supabase/migrations/`. Apply it yourself, in order:

```bash
supabase link --project-ref <project-ref>
supabase migration list --linked
supabase db push --dry-run
supabase db push
```

Never edit the schema only in the Supabase dashboard: create a new migration
instead (`supabase migration new <name>`) and commit it.

## Checks (same as CI)

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## CI and branch protection

`.github/workflows/ci.yml` runs all four checks on every pull request and on
pushes to `main`. It uses no repository secrets, so fork/PR runs stay safe.

Protect `main` in GitHub → Settings → Branches:
- Require a pull request before merging (minimum 1 review).
- Require status check `CI / Lint, Typecheck, Test & Build` to pass before merging.
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.

## Production CI/CD & Environments

Production deployment is managed via `.github/workflows/production.yml` triggered automatically upon successful CI runs on `main` or manually via `workflow_dispatch` on `main`.

### GitHub Secrets and Variables

Configure under GitHub → Settings → Environments → `production`:

| Name | Type | Purpose | Source |
| --- | --- | --- | --- |
| `VERCEL_TOKEN` | Secret | Authenticate Vercel CLI deployments & proxy curl | Vercel Account Settings → Tokens |
| `SUPABASE_ACCESS_TOKEN` | Secret | Authenticate Supabase CLI operations | Supabase Account → Access Tokens |
| `SUPABASE_DB_PASSWORD` | Secret | Direct pooler database password for migrations | Supabase Project Settings → Database |
| `ALERT_WEBHOOK_URL` | Secret (Optional) | Post-deployment success & failure alerts | Slack / Teams / PagerDuty incoming webhook |
| `VERCEL_ORG_ID` | Variable | Vercel Team / Account ID | `.vercel/project.json` or Project Settings |
| `VERCEL_PROJECT_ID` | Variable | Vercel Project identifier | `.vercel/project.json` or Project Settings |
| `SUPABASE_PROJECT_REF` | Variable | Supabase project identifier | Supabase Project Settings → General |
| `SUPABASE_DB_POOLER_HOST` | Variable (Optional) | Custom Supabase pooler host (default: `aws-0-ap-south-1.pooler.supabase.com`) | Supabase Database Settings |

### Environments (Vercel)

| Environment | Supabase project | Notes |
| --- | --- | --- |
| Preview | dev/staging project | never point previews at production data |
| Production | production project | set vars in Vercel → Project → Settings → Environment Variables |

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` per
environment in Vercel. Never commit `.env.local`.

## Post-deploy verification

```bash
curl --fail --silent --show-error https://<your-domain>/api/health
# {"status":"ok"}
```

Then sign in and create one test patient to confirm auth + RLS.

## Rollback Strategy

### Application Rollback
Vercel → Project → Deployments → select previous healthy deployment → "Promote to Production" (instant traffic shift).
Confirm `/api/health` immediately afterwards.

### Database Recovery
- Migrations in production run validate (`migration list`) and dry-run (`db push --dry-run`) prior to applying changes.
- Never run automatic destructive rollbacks (`db reset`) on production.
- Always apply backward-compatible migrations (expand-and-contract). If a schema issue occurs, author and deploy a forward-fix migration.
