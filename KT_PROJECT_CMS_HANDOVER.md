# SanoCare Project KT and CMS Integration Blueprint

Last updated: 2026-04-11
Audience: Engineering, Product, Content Operations, DevOps
Authoring intent: Senior developer level handover with implementation reality + migration path to CMS

## 1) Executive Summary

This project is a Next.js App Router application for SanoCare with live marketing pages, booking flows, contact and CareHub lead capture, and an authenticated Ops dashboard backed by Supabase.

Current state is functional but content is fragmented across:
- central constants,
- page-level hardcoded arrays,
- component-level hardcoded strings,
- static markdown in code.

To scale non-engineering content updates, SEO operations, and multi-page consistency, a CMS layer is required.

This KT provides:
- complete implemented-scope snapshot,
- architecture and data-flow summary,
- CMS domain design,
- API/service integration points,
- detailed text and image data-point mapping,
- phased migration plan with risks and controls.

---

## 2) Current Implementation Snapshot (What Exists Today)

### 2.1 Framework and Core Stack
- Frontend: Next.js 16 + React 19 + TypeScript
- Styling/UI: TailwindCSS + Framer Motion + Lucide icons
- State: Zustand
- Backend/BaaS: Supabase (Auth + DB + Realtime)

### 2.2 Live Functional Areas

1. Marketing web surface
- Homepage with sections: Hero, Stats, Advantage, Testimonials, Features, Journey, Insights, Trust
- Dedicated pages: Services, CareHub, NOW, Contact, Research, Blog Post details
- About page exists but uses placeholder-heavy static content

2. Lead and booking capture
- Home booking form + booking modal + geolocation
- Contact form writes to Supabase table: contact_messages
- CareHub inquiry form writes to Supabase table: carehub_inquiries

3. Ops system
- Ops auth shell and dashboard
- Live Pulse Monitor + Field Force tabs
- Realtime booking inserts/updates from Supabase
- Dispatch and complete visit flows
- Master-admin only create-admin API endpoint

4. Data and persistence baseline
- booking repository abstraction and service layer in place
- Supabase adapter implemented for bookings
- Service factory pattern available for backend swap

---

## 3) Codebase Architecture (As Implemented)

### 3.1 Layering Model

- Presentation layer
  - src/app/* pages
  - src/components/* UI and sections

- Domain/service layer
  - src/services/booking/*
  - src/services/geolocation/*

- Adapter layer
  - src/adapters/supabase/SupabaseBookingRepository.ts
  - src/adapters/browser/BrowserGeolocationProvider.ts

- Composition/factory
  - src/lib/serviceFactory.ts

This is a strong foundation for introducing a CMS adapter without rewriting UI from scratch.

### 3.2 Supabase Schema Artifacts Already Present

- Migration 003
  - carehub_inquiries
  - booking service_category normalization constraint
- Migration 004
  - contact_messages

Ops dashboard also depends on:
- bookings
- paramedics
(assumed pre-existing schema outside listed migrations)

---

## 4) Why CMS Is Required

### 4.1 Business and Delivery Drivers
- Content updates currently require code changes and deployments.
- Same business data exists in multiple files with drift risk.
- SEO metadata is not centrally governed.
- Blog lifecycle is code-centric, not editorial-centric.
- Image assets are mostly remote third-party URLs and not governed by a media system.

### 4.2 Current Pain Points
- Duplicate content structures and repeated labels/CTAs across pages/components.
- Inconsistent service vocabulary in some UI surfaces (legacy and new categories).
- Contact details and support messaging hardcoded in multiple places.
- No editorial workflow (draft/review/publish).

---

## 5 CMS Strategy (Recommended)

## 5.1 Recommended Architecture

Use a headless CMS model integrated through a dedicated content service in this codebase.

Recommended implementation style:
- Option A (preferred with current stack): Supabase-native CMS tables + lightweight internal admin UI.
- Option B: External CMS (Strapi/Sanity/Contentful/Hygraph) + adapter in service layer.

Why Option A is strong here:
- Existing Supabase investment, auth model, and data familiarity.
- Lower integration complexity for current team.
- Faster delivery if editorial workflow needs are moderate.

### 5.2 Runtime Pattern

Page render flow:
1. Load site settings + page model + section payloads from CMS service.
2. Render section components with CMS-provided props.
3. Use local constants only as fallback for resilience.

---

## 6) Target CMS Domain Model

## 6.1 Core Entities

1. site_config (singleton)
- company_name
- tagline
- phone_primary
- phone_secondary
- email_primary
- email_support
- address_line_1
- address_line_2
- maps_url
- service_area_text
- social_links (json)
- legal_links (json)
- default_seo (json)

2. pages
- slug (homepage, services, now, carehub, contact, about, research)
- title
- status (draft/published)
- seo_title
- seo_description
- seo_keywords
- og_image_asset_id

3. page_sections
- page_id
- section_key (hero, stats, testimonials, etc.)
- heading
- subheading
- body_rich_text
- cta_primary_label
- cta_primary_url
- cta_secondary_label
- cta_secondary_url
- payload_json
- sort_order
- is_active

4. services_catalog
- slug
- title
- short_description
- long_description
- icon_name
- category
- price_label
- price_value
- duration_label
- feature_list (json)
- display_order
- is_active

5. testimonials
- quote
- person_name
- treatment_label
- avatar_initial
- avatar_asset_id
- rating
- display_order
- is_active

6. doctors
- full_name
- role
- qualification
- bio
- profile_asset_id
- specializations (json)
- display_order
- is_active

7. blog_posts
- slug
- title
- excerpt
- category
- read_time
- body_markdown
- featured_asset_id
- author_name
- author_role
- author_avatar_asset_id
- published_at
- status
- seo_title
- seo_description
- og_image_asset_id

8. announcements
- message
- highlight_text
- icon_key
- link_url
- link_label
- start_at
- end_at
- display_order
- is_active

9. media_assets
- storage_path
- public_url
- alt_text
- caption
- width
- height
- mime_type
- source_license

10. navigation_links
- location (navbar, footer_services, footer_resources, floating_sidebar)
- label
- href
- display_order
- is_active

### 6.2 Existing Operational Tables Kept as-is
- bookings
- contact_messages
- carehub_inquiries
- paramedics

These are transactional/operational and should not be merged into CMS content tables.

---

## 7) Integration Touchpoints in This Project

Add new module:
- src/services/cms/CmsService.ts

Responsibilities:
- fetchSiteConfig()
- fetchPage(slug)
- fetchSections(pageSlug)
- fetchServices(filter)
- fetchTestimonials()
- fetchBlogPostBySlug(slug)
- fetchBlogList()
- fetchAnnouncements()
- fetchNavigation(location)

Then progressively wire pages/components to CmsService with fallback constants during migration.

---

## 8) Detailed Content Mapping: Text Data Points

This section lists every currently managed text cluster to be connected into CMS.

Legend:
- Type: short_text | rich_text | markdown | list | url | enum
- Source: current file location
- Target: proposed CMS entity.field

### 8.1 Global Brand and Contact

1. Brand identity
- Source: src/constants/content.ts (COMPANY_INFO.name, tagline)
- Type: short_text
- Target: site_config.company_name, site_config.tagline

2. Contact details
- Source: src/constants/content.ts, src/components/Footer.tsx, src/app/contact/page.tsx, src/components/TopBanner.tsx, src/components/MobileStickyBar.tsx, src/components/FloatingSidebar.tsx
- Type: short_text + url
- Target: site_config.phone_primary, phone_secondary, email_primary, email_support, maps_url

3. Address and working hours
- Source: src/app/contact/page.tsx (contactInfo array)
- Type: short_text list
- Target: site_config.address_line_1, address_line_2, service_hours_text

4. Legal links and social links
- Source: src/components/Footer.tsx
- Type: list
- Target: navigation_links + site_config.legal_links/social_links

### 8.2 Homepage: Hero and Booking Surface

1. Hero badge and heading
- Source: src/components/Hero.tsx
- Type: short_text
- Target: page_sections(payload_json.hero.badge, title_line_1, title_line_2)

2. Hero subtext
- Source: src/components/Hero.tsx
- Type: rich_text
- Target: page_sections.payload_json.hero.description

3. Hero inline stats
- Source: src/components/Hero.tsx
- Type: list
- Target: page_sections.payload_json.hero.quick_stats[]

4. Trust line and star/rating text
- Source: src/components/Hero.tsx
- Type: short_text
- Target: page_sections.payload_json.hero.trust_block

5. Booking form labels, placeholders, helper texts, validation and success/error copy
- Source: src/components/Hero.tsx, src/components/BookingModal.tsx
- Type: short_text list
- Target: page_sections.payload_json.booking_form

6. Service dropdown labels and category values
- Source: src/components/Hero.tsx (new category values), src/components/BookingModal.tsx (legacy values)
- Type: enum + label map
- Target: services_catalog.slug/title + site_config.booking_service_options

### 8.3 Homepage: Stats, Features, Journey, Testimonials, Insights, Trust

1. Stats section heading, description, metric labels, subtexts
- Source: src/components/StatsBar.tsx
- Type: short_text/list
- Target: page_sections(section_key=stats)

2. Features cards
- Source: src/components/Features.tsx
- Fields: title, description, features[], price
- Type: short_text + list
- Target: services_catalog + page_sections(section_key=features)

3. Journey steps
- Source: src/components/Journey.tsx
- Fields: step number, title, description
- Type: short_text + rich_text
- Target: page_sections(section_key=journey).payload_json.steps[]

4. Testimonials
- Source: src/components/Testimonials.tsx
- Fields: quote, name, treatment, initial
- Type: rich_text + short_text
- Target: testimonials

5. Insights cards on homepage
- Source: src/components/Insights.tsx
- Fields: slug, category, readTime, title, description
- Type: short_text
- Target: blog_posts (published list render)

6. Accreditation/trust badges and trust stats line
- Source: src/components/Accreditations.tsx
- Type: short_text list
- Target: page_sections(section_key=trust_badges)

### 8.4 Navigation, Banner, Footer, Action Rails

1. Navbar links and CTA labels
- Source: src/components/Navbar.tsx
- Type: list
- Target: navigation_links(location=navbar)

2. Top rotating announcements
- Source: src/components/TopBanner.tsx
- Type: short_text + highlight token
- Target: announcements

3. Floating sidebar actions
- Source: src/components/FloatingSidebar.tsx
- Type: list
- Target: navigation_links(location=floating_sidebar)

4. Mobile sticky bar labels
- Source: src/components/MobileStickyBar.tsx
- Type: short_text
- Target: page_sections(section_key=mobile_sticky_actions)

5. Footer services/resources links and brand paragraph
- Source: src/components/Footer.tsx
- Type: list + rich_text
- Target: navigation_links + site_config.brand_description

### 8.5 Services Page Content

- Source: src/app/services/page.tsx
- Data clusters to CMS:
1. Hero badge/title/subtitle/CTA labels
2. medicalServices cards (6 items)
3. advantagePoints (3 items)
4. signaturePrograms cards (3 items)
5. section headings/subheadings across page blocks

Target:
- pages(slug=services)
- services_catalog (where applicable)
- page_sections(section_key per block)

### 8.6 NOW Page Content

- Source: src/app/now/page.tsx
- Data clusters to CMS:
1. Hero badge/title/body/phone CTA label
2. Stats strip values/labels
3. Service cards with price and duration metadata
4. How-it-works steps
5. Advantages list

Target:
- pages(slug=now)
- services_catalog(category=now)
- page_sections

### 8.7 CareHub Page Content

- Source: src/app/carehub/page.tsx
- Data clusters to CMS:
1. Hero and CTA copy
2. Stats strip values
3. Benefits cards
4. How-it-works steps
5. Inquiry form labels/messages/help texts

Target:
- pages(slug=carehub)
- page_sections
- site_config/contact subset for phone/email where repeated

### 8.8 Contact Page Content

- Source: src/app/contact/page.tsx
- Data clusters to CMS:
1. Hero heading and intro
2. contactInfo card labels/details/linkText
3. Form labels/placeholders/success-error copy
4. Service areas text
5. FAQ CTA copy and button labels

Target:
- pages(slug=contact)
- page_sections
- site_config

### 8.9 Blog and Research Content

1. Blog posts
- Source: src/data/blog-posts.ts
- Fields: slug, category, readTime, title, description, image, author, publishedAt, content markdown
- Type: markdown + metadata
- Target: blog_posts + media_assets

2. Blog detail page helper copy
- Source: src/app/blog/[slug]/page.tsx
- Type: short_text/rich_text
- Target: page_sections(section_key=blog_template)

3. Research page facts and cards
- Source: src/app/research/page.tsx
- Type: list
- Target: pages(slug=research) + page_sections

### 8.10 About Page Content (Currently Placeholder-heavy)

- Source: src/app/about/page.tsx
- Data clusters:
1. company info constants (founding year, founder name, founder quote, city/state placeholders)
2. STATS array
3. PILLARS array
4. VALUES array
5. MILESTONES array
6. TEAM_MEMBERS array
7. ACCREDITATIONS array

Target:
- pages(slug=about)
- page_sections (hero, pillars, values, milestones, team, accreditations)
- site_config (canonical company fields)

---

## 9) Detailed Content Mapping: Image Data Points

This section enumerates all key image assets that need media governance in CMS.

Legend:
- Source type: remote_url | local_public_asset | future_upload
- Target: media_assets + referencing entity field

### 9.1 Core Brand Assets
1. Logo
- Source: public/logo.svg (used in navbar/footer/ops)
- Source type: local_public_asset
- Target: media_assets + site_config.logo_asset_id

2. Favicon/manifest assets
- Source: public/manifest.json and linked icon stack
- Source type: local_public_asset
- Target: site_config.favicon_asset_id + PWA config

### 9.2 Homepage and Shared Section Images

1. Hero background image
- Source: src/components/Hero.tsx (unsplash URL in backgroundImage style)
- Target: page_sections.hero.background_asset_id

2. Journey step images (3)
- Source: src/components/Journey.tsx (journeySteps[].image)
- Target: page_sections.journey.steps[].image_asset_id

3. Insights card images (3 previews)
- Source: src/components/Insights.tsx (articles[].image)
- Target: blog_posts.featured_asset_id

### 9.3 Blog Assets

1. Featured image per blog post
- Source: src/data/blog-posts.ts (BLOG_POSTS[].image)
- Target: blog_posts.featured_asset_id

2. Author avatars (currently optional)
- Source: src/data/blog-posts.ts author.avatar? + fallback icon in page
- Target: blog_posts.author_avatar_asset_id or doctors.profile_asset_id

### 9.4 Services/NOW/CareHub/About Page Visuals

1. Services page hero image
- Source: src/app/services/page.tsx (Image src unsplash)
- Target: pages/services hero image asset

2. NOW page hero and process image
- Source: src/app/now/page.tsx (2 unsplash images)
- Target: pages/now section image assets

3. CareHub page hero and process image
- Source: src/app/carehub/page.tsx (2 unsplash images)
- Target: pages/carehub section image assets

4. About page hero image placeholder
- Source: src/app/about/page.tsx (commented placeholder image)
- Target: pages/about hero image asset (future_upload)

### 9.5 Compliance for Media

For each asset in media_assets:
- mandatory alt_text,
- source attribution,
- license status,
- optimized renditions for web,
- last-reviewed timestamp.

---

## 10) Content Data Governance Rules (Mandatory)

1. Single source of truth
- After migration, no marketing copy should remain hardcoded in page/component files except local fallback constants.

2. Service slug normalization
- Standardize to: homecare, teleconsult, chronic, diagnostics
- Keep legacy aliases only as temporary compatibility mapping.

3. Media policy
- Move remote third-party images to controlled storage/CDN.
- Enforce alt text and licensing metadata.

4. Editorial workflow
- status lifecycle: draft -> in_review -> approved -> published

5. Change control
- Every CMS publish event logs actor, fields changed, and timestamp.

6. Fail-safe rendering
- If CMS unavailable, fallback to local constants for business-critical pages.

---

## 11) Implementation Plan for CMS Migration

### Phase 0: Prep (2-3 days)
- Finalize schema and choose platform (Supabase-native recommended)
- Build content model dictionary
- Create migration script templates

### Phase 1: Foundation (4-6 days)
- Create CMS tables/entities
- Build CmsService with typed interfaces
- Build read adapters and fallback wrappers
- Add cache strategy (revalidate and server caching)

### Phase 2: High impact migration (5-7 days)
- Homepage sections
- Navbar/Footer/TopBanner/FloatingSidebar/MobileStickyBar
- Services and NOW pages

### Phase 3: Editorial migration (4-5 days)
- Blog posts from src/data/blog-posts.ts to CMS
- CareHub and Contact page copy
- Research page facts

### Phase 4: About and long-tail sections (3-4 days)
- Replace placeholder content
- migrate all remaining static arrays

### Phase 5: Hardening (3-5 days)
- SEO metadata integration per page
- image optimization and asset governance
- access control and approval workflow
- remove dead hardcoded paths

---

## 12) Engineering Tasks and Ownership

1. Backend/content platform
- Create tables and policies
- Build typed query layer
- Owner: Backend/full-stack

2. Frontend integration
- Section-by-section prop refactor to CMS payloads
- Owner: Frontend

3. DevOps/observability
- Caching, fallback telemetry, publish logs
- Owner: DevOps/full-stack

4. Content ops enablement
- Editorial playbook, field help-text, QA checklist
- Owner: Product + Content + QA

---

## 13) Known Risks and Mitigation

1. Drift risk during transition
- Mitigation: dual-read mode with feature flags and content parity checklist

2. Category mismatch in booking service options
- Mitigation: canonical enum mapping utility in one module

3. SEO regression
- Mitigation: preserve existing metadata until CMS metadata is validated in staging

4. Broken images after migration
- Mitigation: bulk media validator before publish

5. Ops impact risk
- Mitigation: isolate CMS migration from operational tables and workflows

---

## 14) Acceptance Criteria for CMS Completion

CMS migration is considered complete when all are true:
- All marketing and informational text/image assets are editable without code change.
- Homepage, Services, NOW, CareHub, Contact, About, Research, Blog are CMS-driven.
- Navbar/Footer/banner/action-rail labels and links are CMS-driven.
- Blog create/edit/publish works with markdown/rich editor.
- Media assets are managed in controlled storage with alt text and license metadata.
- Fallback rendering and monitoring are in place.
- No critical hardcoded content remains in presentation components.

---

## 15) Appendix: Primary Source Files in Current State

Core content and data sources:
- src/constants/content.ts
- src/constants/pricing.ts
- src/data/blog-posts.ts

Major content-consuming pages/components:
- src/app/page.tsx
- src/app/services/page.tsx
- src/app/now/page.tsx
- src/app/carehub/page.tsx
- src/app/contact/page.tsx
- src/app/about/page.tsx
- src/app/research/page.tsx
- src/app/blog/[slug]/page.tsx
- src/components/Hero.tsx
- src/components/Features.tsx
- src/components/StatsBar.tsx
- src/components/Journey.tsx
- src/components/Testimonials.tsx
- src/components/Insights.tsx
- src/components/Accreditations.tsx
- src/components/TopBanner.tsx
- src/components/Navbar.tsx
- src/components/Footer.tsx
- src/components/FloatingSidebar.tsx
- src/components/MobileStickyBar.tsx
- src/components/BookingModal.tsx

Operational/persistence references:
- src/lib/serviceFactory.ts
- src/services/booking/BookingService.ts
- src/adapters/supabase/SupabaseBookingRepository.ts
- src/app/api/ops/create-admin/route.ts
- supabase/migrations/003_carehub_and_service_categories.sql
- supabase/migrations/004_contact_messages.sql

---

## 16) Immediate Next Actions (Recommended)

1. Approve CMS platform decision (Supabase-native vs external).
2. Approve canonical field dictionary and enum set.
3. Implement CmsService interfaces and table schema.
4. Start migration with global config + homepage + navigation content.
5. Move blog and images to managed CMS media before scale-out.
