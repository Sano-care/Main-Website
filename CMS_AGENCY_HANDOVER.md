# CMS Production Handover

## 1. Webhook Wiring (Supabase -> Next.js)

Create two Database Webhooks in Supabase Dashboard:

1. Table: `cms_sections`
2. Events: `INSERT`, `UPDATE`, `DELETE`
3. URL: `https://your-domain.com/api/cms-update`
4. Header: `x-cms-secret: <CMS_REVALIDATE_SECRET>`

Repeat the same for:

1. Table: `cms_blog_posts`
2. Events: `INSERT`, `UPDATE`, `DELETE`
3. URL: `https://your-domain.com/api/cms-update`
4. Header: `x-cms-secret: <CMS_REVALIDATE_SECRET>`

Recommended third webhook for global brand/contact updates:

1. Table: `cms_site_globals`
2. Events: `UPDATE`
3. URL: `https://your-domain.com/api/cms-update`
4. Header: `x-cms-secret: <CMS_REVALIDATE_SECRET>`

## 2. Smoke Test for Live Updates

1. Edit one row in `cms_sections` (for example a headline in `home.hero`).
2. Wait 1-2 seconds.
3. Refresh the website page.
4. Confirm content changed without redeploy.

Repeat with:

1. `cms_blog_posts` title/body update.
2. `cms_site_globals.phone_primary` update and verify footer phone updates.

## 3. Environment Variables

Set these in your deployment platform:

1. `CMS_REVALIDATE_SECRET` (required for `/api/cms-update`)
2. `CMS_ADMIN_SECRET` (recommended for `/cms-admin`, optional fallback to `CMS_REVALIDATE_SECRET`)
3. `NEXT_PUBLIC_SUPABASE_URL`
4. `NEXT_PUBLIC_ANON_KEY`
5. `SUPABASE_SERVICE_ROLE_KEY` (required for `/api/cms-admin`)

## 4. Agency Editing Path

Option A (fastest): use Supabase Table Editor with CMS role.

Option B (custom editor): use `/cms-admin`.

`/cms-admin` supports:

1. Site globals updates (`cms_site_globals`)
2. Section JSON updates (`cms_sections`)
3. Blog post updates (`cms_blog_posts`)

Every save in `/cms-admin` triggers cache revalidation automatically.

## 5. Security Checklist

1. Share secrets only through your password manager.
2. Never expose service role key in client-side code.
3. Restrict Supabase Editor role to CMS tables only.
4. Rotate `CMS_REVALIDATE_SECRET` and `CMS_ADMIN_SECRET` quarterly.
