# Strategic Blueprint: SanoCare Independent Content Management System (CMS)

**Document Status:** High-Level Guiding Architecture  
**Focus:** Pure Content Decoupling & Static Site Optimization  
**Core Directive:** This CMS is to be built as a **sovereign entity**. It must have zero dependencies on the current Ops panel, and its architecture must remain unaffected by the future deprecation of the Ops panel or the launch of a new mobile app. It exists solely to manage the "Static Surface" of SanoCare.

---

## 1. The Principle of Absolute Isolation
The CMS layer shall be treated as a "Content Vault." 
- **Operational Independence:** The logic for changing a hero banner or a service description must never touch the logic for managing a booking or a patient.
- **Architectural Immunity:** If the Ops panel is deleted tomorrow, the CMS remains fully functional. If a new App is launched, it simply becomes another "reader" of the CMS data, without the CMS needing to change its core structure.
- **Code Separation:** All CMS-related logic should reside in dedicated directories (e.g., `src/services/cms` and `src/app/(cms)`) to ensure no "spaghetti code" logic connects it to the transactional parts of the site.

---

## 2. The Data Layer: The "Content Vault" (Supabase)
The database strategy shifts from "Operational" to "Informational." We will create a suite of tables in Supabase that serve as a **Content API**.

### A. Table Structure (The Content Schema)
- **`cms_site_globals`**: A single-row table for "Everywhere" data (Logos, support phone, primary email, social links, footer copyright).
- **`cms_page_registry`**: Defines the pages (Home, Services, NOW, About). Stores SEO metadata (titles, descriptions, OG images).
- **`cms_sections`**: The modular blocks of the website. Each row links to a page and contains a `content_json` field to store headlines, body text, and button labels.
- **`cms_collections`**: Structured data lists that don't change daily (The list of Services, the Team/Doctor profiles, Testimonials).

### B. Media Assets
- A dedicated Supabase Storage bucket: `cms_assets`.  
- **Rule:** Images are never hardcoded. The database stores the URL; the storage bucket stores the file.

---

## 3. The Delivery Engine: Static-First ISR
To ensure the website remains blazing fast and SEO-optimized, we utilize **Incremental Static Regeneration (ISR)**.

### The Flow:
1. **The Build:** Next.js fetches data from the "Content Vault" during build time and generates static HTML.
2. **The Cache:** Netlify serves these static files via its CDN. No database is touched when a user visits the site.
3. **The Update (On-Demand):** When a change is made in the "Content Vault," the CMS triggers a **Cache Purge** (via Webhook) to refresh the static content.

---

## 4. The "Ghost" Webhook Mechanism
This is the invisible thread that keeps the site updated without manual deployments.

1. **The Endpoint:** Build a secure route `src/app/api/cms-update/route.ts`.
2. **The Security:** This route only responds to requests containing a high-entropy secret key stored in environment variables.
3. **The Trigger:** 
   - Supabase is configured with a **Database Webhook**.
   - Whenever a row in any `cms_` table is updated/deleted, Supabase pings the Next.js endpoint.
   - Next.js runs `revalidatePath('/')` or `revalidateTag('cms')`.
4. **The Result:** The site updates within seconds of a database change, while the database remains "asleep" and protected from web traffic.

---

## 5. The Editor Interface: "Content Control Center"
To maintain total separation from the Ops panel, the interface for editing must be lightweight and isolated.

- **Option Alpha (Immediate):** Use **Supabase Studio** directly. The external agency is given a "Content Editor" role in Supabase. They edit the rows like a spreadsheet. The webhooks handle the rest. This requires **zero** frontend UI work.
- **Option Beta (Stand-alone Route):** If a custom UI is required, it should be built at a dedicated path (e.g., `/admin-content`) using standard HTML forms. It must be protected by its own middleware and not share any state with the Ops or Booking flows.

---

## 6. Implementation Roadmap

### Phase 1: The Schema (Day 1-2)
- Deploy the `cms_` tables to Supabase.
- Seed the tables with the current hardcoded content from the codebase.
- Setup the `cms_assets` storage bucket.

### Phase 2: The Data Service (Day 2-3)
- Build the `CmsService.ts` to fetch this data using Server Actions/Server Components.
- Implement "Fail-safe" constants: If the DB is empty, the code falls back to the original hardcoded strings to ensure the site never goes blank.

### Phase 3: The Webhook Handshake (Day 3-4)
- Create the secret-token-protected API route in Next.js.
- Configure the Supabase Webhook to fire on all `cms_` table changes.
- Test the "Live Refresh" by changing a value in the DB and watching the site update.

### Phase 4: Full Page Migration (Day 4-7)
- **Batch 1:** Global Brand & Contact info.
- **Batch 2:** Blog & Research items.
- **Batch 3:** Landing page sections (Hero, Stats, Advantages).

---

## 7. Development Guardrails for the Team
1. **CMS is Read-Only for Public:** Ensure Row Level Security (RLS) in Supabase allows the public to `SELECT` but never `INSERT/UPDATE` the CMS tables.
2. **Component Purity:** Presentation components should receive content via `props`. They shouldn't care if the content came from a hardcoded file or a database.
3. **Static by Default:** If you find yourself writing `useEffect` to fetch CMS data, you are doing it wrong. Use Server Components.
4. **No Ops-Bleed:** Do not import any types, constants, or utilities from the `/ops` or `/booking` folders into the `/cms` folders.