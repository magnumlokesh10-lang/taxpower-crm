# TaxPower CRM

Private console for Siddharth Enterprises: website enquiries, leads and follow-ups, clients,
a team with roles, and a blog editor that publishes to taxpower.co.

It runs on its own: one Cloudflare Worker (this repo) + one Supabase project (database and logins).
No Lovable, no framework, no build step, no npm packages.

```
public/            the CRM screens (index.html, css/, js/, config.js)
worker/index.js    the server: /api/public/lead, /api/public/staff, /api/public/blog
supabase/          schema.sql = whole database for a fresh Supabase project
tests/             node --test tests/   (checks the server logic, no network needed)
```

## How it connects to the website

```
taxpower.co form  --POST-->  crm.taxpower.co/api/public/lead  -->  Leads (source: Website form)
CRM Blog -> Publish --GitHub API--> taxpower-update/content/blog/*.json
                                    --GitHub Action--> builds the site --> taxpower.co/blog/...
```

## One-time setup

### 1. Supabase (database + logins)
1. supabase.com -> New project (free plan is enough).
2. SQL editor -> paste `supabase/schema.sql` -> Run.
3. Create the first admin: follow the note at the bottom of `schema.sql`.
4. Project settings -> API: copy the **Project URL**, the **anon (public) key** and the **service_role key**.
5. Authentication -> URL configuration: Site URL `https://crm.taxpower.co`, Redirect URLs `https://crm.taxpower.co/**`.
6. Put the Project URL and the anon key in `public/config.js`.
   (The anon key is meant to be public. The service_role key must never go in the repo.)

### 2. Cloudflare (hosting)
1. Cloudflare -> Workers & Pages -> Create -> Import a repository -> this repo. No build command.
2. Settings -> Variables and secrets, add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (secret)
   - `GITHUB_TOKEN` = fine-grained token, repo `taxpower-update`, Contents: read and write (secret)
3. Settings -> Domains -> add `crm.taxpower.co`.

### 3. Website repo (taxpower-update)
Settings -> Secrets and variables -> Actions -> new secret `TAXPOWER_CO_TOKEN`: fine-grained token,
repo `taxpower.co`, Contents: read and write. The workflow `.github/workflows/deploy.yml` there publishes the site
when an article is published from the CRM.

## Day to day
Sign in at crm.taxpower.co. Dashboard shows today's picture. Team -> add logins and choose who may write articles.
Blog -> New article -> Preview -> Publish (live in about 2 minutes).

## Local checks
`node --test tests/` runs the server tests. To look at the screens, serve `public/` with any static server.
