# Supabase Migrations

Alpha Dog uses the Supabase CLI for production schema migrations.

## Auth

Use a temporary Supabase personal access token and load it from the shell profile
used by the OpenClaw gateway:

```bash
export SUPABASE_ACCESS_TOKEN="..."
```

Do not commit tokens or paste them into chat. Revoke temporary tokens after the
migration is complete.

## Link The Project

The production Alpha Dog Supabase project ref is:

```text
dobxknlhfuoukmqjywjy
```

From the repo root:

```bash
npx supabase link --project-ref dobxknlhfuoukmqjywjy
```

The CLI writes generated metadata under `supabase/.temp`, which is ignored by
git.

## Apply Migrations

Check local and remote history before applying:

```bash
npx supabase migration list
```

When local and remote history line up, apply pending migrations with:

```bash
npx supabase db push
```

For a one-off additive SQL file that has already been reviewed and must be
applied directly:

```bash
npx supabase db query --linked --file supabase/migrations/<version>_<name>.sql
npx supabase migration repair --status applied <version> --yes
```

Only use the direct query plus repair path when `db push` cannot be used and the
SQL is idempotent or has already been manually verified.

## Verify

After applying, confirm history is aligned:

```bash
npx supabase migration list
```

For column-level verification, use `information_schema`, for example:

```bash
npx supabase db query --linked \
  "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by table_name, column_name;"
```
