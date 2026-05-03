### The Plan: "The Self-Mapping Media Tree"

#### 1. The Strategy
Instead of the Section looking for an Image, the **Image will announce which Section it belongs to.** 
When you load the "About Page" on the frontend, your service will simply say: *"Give me the text from the JSON blobs AND give me all images tagged with `page: about`."*

#### 2. The Tagging System
We add three specific "Location Tags" to every row in `cms_media_assets`:
*   **`page_slug`**: (e.g., 'about', 'home')
*   **`section_key`**: (e.g., 'team_members', 'hero_background')
*   **`item_key`**: (e.g., 'member_aranya', 'step_1') — *This allows you to map specific images to specific items inside a list.*

#### 3. The Admin UI Flow
When the agency opens the "About Page" editor:
1.  The UI looks at the `cms_sections` JSON for the text.
2.  The UI looks at `cms_media_assets` filtered by `page_slug = 'about'`.
3.  It matches them up. If the agency uploads a new photo for "Member 1," the Admin UI just updates that asset's `item_key` to `member_1`.

---

### The SQL: Schema Update

Run this to add the "Mapping" columns to your existing media table. This is simple, clean, and doesn't break your existing text flow.

```sql
-- ------------------------------------------------------------
-- 1. ADD MAPPING TAGS TO ASSETS
-- This allows every image to know exactly where it lives
-- ------------------------------------------------------------
ALTER TABLE cms_media_assets 
ADD COLUMN IF NOT EXISTS page_slug TEXT,
ADD COLUMN IF NOT EXISTS section_key TEXT,
ADD COLUMN IF NOT EXISTS item_key TEXT;

-- ------------------------------------------------------------
-- 2. CREATE SEARCH INDEXES
-- Ensures that when a page loads, finding its 10 images is instant
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cms_media_assets_location 
ON cms_media_assets(page_slug, section_key);

-- ------------------------------------------------------------
-- 3. HELPER VIEW (OPTIONAL)
-- A 'Media Tree' view for your Admin UI to show what's missing
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW cms_view_media_tree AS
SELECT 
  page_slug, 
  section_key, 
  item_key, 
  public_url, 
  alt_text
FROM cms_media_assets
WHERE deleted_at IS NULL
ORDER BY page_slug, section_key, item_key;
```

---

### Next Steps for Implementation:

**1. The "Tagging" Sweep:**
Go into your `cms_media_assets` table in Supabase and manually fill in the `page_slug` and `section_key` for your existing images (like the logos and hero backgrounds).

**2. The Frontend "Dual-Fetch":**
Update your `CmsContentServerService.ts`. When fetching a page, make it fetch two things in parallel:
*   `cms_sections` (for the text).
*   `cms_media_assets` WHERE `page_slug` matches.

**3. The Admin UI "Context":**
In your `/cms-admin` page, when the agency is editing the "About" section, the "Image Upload" button should automatically include `page_slug: 'about'` and `section_key: 'team'` in the metadata of the upload.

