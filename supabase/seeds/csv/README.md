# CMS Seed CSV Package

This folder contains phased CSV files aligned to `supabase/migrations/005_cms_schema.sql`.

## Import Strategy (Step-by-step)

1. Import `01_core` first.
2. Import `02_navigation` and `03_domain` next.
3. Import `04_content/cms_sections.csv` and `04_content/cms_collections.csv`.
4. Import `05_blog/cms_blog_posts.csv`.
5. Use `06_media/cms_media_assets_template.csv` when you start moving URLs to `cms_media_assets`.

## Important Notes

- `cms_sections.csv` rows are seeded as `is_active=false` with `{}` content by default.
- This avoids overriding safe code fallbacks until content editors complete each section.
- After filling `content_json`, set `is_active=true` for that row.
- `cms_page_registry` uses fixed UUIDs so section `page_id` references are stable.
- Keep `status='published'` on pages meant for public rendering.

## Suggested Import Order

1. `01_core/cms_site_globals.csv`
2. `01_core/cms_page_registry.csv`
3. `02_navigation/cms_navigation_links.csv`
4. `02_navigation/cms_announcements.csv`
5. `03_domain/cms_booking_service_options.csv`
6. `03_domain/cms_services_catalog.csv`
7. `03_domain/cms_testimonials.csv`
8. `03_domain/cms_doctors.csv`
9. `04_content/cms_sections.csv`
10. `04_content/cms_collections.csv`
11. `05_blog/cms_blog_posts.csv`
12. `06_media/cms_media_assets_template.csv` (optional initially)
