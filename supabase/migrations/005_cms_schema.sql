-- Migration: Create isolated CMS schema for static content surfaces
-- Scope: cms_* tables only (no coupling with ops or booking transactional tables)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------
-- Enums
-- ------------------------------
DO $$
BEGIN
  CREATE TYPE cms_content_status AS ENUM (
    'draft',
    'in_review',
    'approved',
    'published',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE cms_nav_location AS ENUM (
    'navbar',
    'footer_services',
    'footer_resources',
    'floating_sidebar',
    'mobile_sticky'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE cms_publish_action AS ENUM (
    'create',
    'update',
    'delete',
    'publish',
    'unpublish',
    'status_change'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ------------------------------
-- Shared helpers
-- ------------------------------
CREATE OR REPLACE FUNCTION cms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cms_is_editor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'cms_role') IN ('editor', 'publisher', 'admin'),
    false
  );
$$;

-- ------------------------------
-- Core CMS tables
-- ------------------------------
CREATE TABLE IF NOT EXISTS cms_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  caption TEXT,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  source_license TEXT NOT NULL DEFAULT 'internal',
  source_attribution TEXT,
  deleted_at TIMESTAMPTZ,
  cleanup_required BOOLEAN NOT NULL DEFAULT false,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS cms_site_globals (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
  company_name TEXT NOT NULL,
  tagline TEXT,
  brand_description TEXT,
  phone_primary TEXT,
  phone_secondary TEXT,
  email_primary TEXT,
  email_support TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  maps_url TEXT,
  service_area_text TEXT,
  service_hours_text TEXT,
  social_links_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  legal_links_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_seo_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  logo_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  favicon_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_site_globals_singleton_id CHECK (
    id = '00000000-0000-0000-0000-000000000001'
  )
);

CREATE TABLE IF NOT EXISTS cms_page_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status cms_content_status NOT NULL DEFAULT 'draft',
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT,
  og_image_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_page_registry_slug_check CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE TABLE IF NOT EXISTS cms_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES cms_page_registry(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  heading TEXT,
  subheading TEXT,
  body_rich_text TEXT,
  cta_primary_label TEXT,
  cta_primary_url TEXT,
  cta_secondary_label TEXT,
  cta_secondary_url TEXT,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_sections_unique_order UNIQUE (page_id, section_key, sort_order)
);

CREATE TABLE IF NOT EXISTS cms_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  description TEXT,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_collections_unique_item UNIQUE (collection_key, item_key)
);

CREATE TABLE IF NOT EXISTS cms_services_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_description TEXT,
  long_description TEXT,
  icon_name TEXT,
  category TEXT,
  price_label TEXT,
  price_value NUMERIC(12,2),
  duration_label TEXT,
  feature_list_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_services_catalog_slug_check CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE TABLE IF NOT EXISTS cms_booking_service_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_slug TEXT NOT NULL UNIQUE CHECK (
    canonical_slug IN ('homecare', 'teleconsult', 'chronic', 'diagnostics')
  ),
  label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  legacy_aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote TEXT NOT NULL,
  person_name TEXT NOT NULL,
  treatment_label TEXT,
  avatar_initial TEXT,
  avatar_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  role TEXT,
  qualification TEXT,
  bio TEXT,
  profile_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  specializations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  category TEXT,
  read_time TEXT,
  body_markdown TEXT NOT NULL,
  featured_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  author_name TEXT,
  author_role TEXT,
  author_avatar_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  status cms_content_status NOT NULL DEFAULT 'draft',
  seo_title TEXT,
  seo_description TEXT,
  og_image_asset_id UUID REFERENCES cms_media_assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_blog_posts_slug_check CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE TABLE IF NOT EXISTS cms_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  highlight_text TEXT,
  icon_key TEXT,
  link_url TEXT,
  link_label TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cms_announcements_window_check CHECK (
    start_at IS NULL OR end_at IS NULL OR start_at <= end_at
  )
);

CREATE TABLE IF NOT EXISTS cms_navigation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location cms_nav_location NOT NULL,
  label TEXT NOT NULL,
  href TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_publish_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID,
  action cms_publish_action NOT NULL,
  actor_user_id UUID,
  actor_email TEXT,
  changed_fields JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------
-- Indexes
-- ------------------------------
CREATE INDEX IF NOT EXISTS idx_cms_page_registry_status
  ON cms_page_registry(status);

CREATE INDEX IF NOT EXISTS idx_cms_media_assets_deleted_at
  ON cms_media_assets(deleted_at);

CREATE INDEX IF NOT EXISTS idx_cms_sections_page_active_order
  ON cms_sections(page_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_cms_collections_key_active_order
  ON cms_collections(collection_key, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_cms_services_category_active_order
  ON cms_services_catalog(category, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_cms_testimonials_active_order
  ON cms_testimonials(is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_cms_doctors_active_order
  ON cms_doctors(is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_cms_blog_posts_status_published_at
  ON cms_blog_posts(status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_cms_announcements_active_window
  ON cms_announcements(is_active, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_cms_navigation_location_active_order
  ON cms_navigation_links(location, is_active, display_order);

CREATE INDEX IF NOT EXISTS idx_cms_publish_audit_log_created_at
  ON cms_publish_audit_log(created_at DESC);

-- ------------------------------
-- Automatic audit logging
-- ------------------------------
CREATE OR REPLACE FUNCTION cms_log_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action cms_publish_action;
  v_record_id UUID;
  v_actor_user_id UUID;
  v_actor_email TEXT;
  v_old JSONB;
  v_new JSONB;
BEGIN
  v_actor_user_id := auth.uid();
  v_actor_email := auth.jwt() ->> 'email';

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_record_id := NEW.id;
    v_new := to_jsonb(NEW);
    INSERT INTO cms_publish_audit_log (table_name, record_id, action, actor_user_id, actor_email, changed_fields)
    VALUES (TG_TABLE_NAME, v_record_id, v_action, v_actor_user_id, v_actor_email, jsonb_build_object('new', v_new));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    IF (v_old ? 'status') AND ((v_old ->> 'status') IS DISTINCT FROM (v_new ->> 'status')) THEN
      IF (v_old ->> 'status') <> 'published' AND (v_new ->> 'status') = 'published' THEN
        v_action := 'publish';
      ELSIF (v_old ->> 'status') = 'published' AND (v_new ->> 'status') <> 'published' THEN
        v_action := 'unpublish';
      ELSE
        v_action := 'status_change';
      END IF;
    ELSE
      v_action := 'update';
    END IF;

    INSERT INTO cms_publish_audit_log (table_name, record_id, action, actor_user_id, actor_email, changed_fields)
    VALUES (
      TG_TABLE_NAME,
      v_record_id,
      v_action,
      v_actor_user_id,
      v_actor_email,
      jsonb_build_object('old', v_old, 'new', v_new)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_record_id := OLD.id;
    v_old := to_jsonb(OLD);
    INSERT INTO cms_publish_audit_log (table_name, record_id, action, actor_user_id, actor_email, changed_fields)
    VALUES (TG_TABLE_NAME, v_record_id, v_action, v_actor_user_id, v_actor_email, jsonb_build_object('old', v_old));
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'cms_media_assets',
    'cms_site_globals',
    'cms_page_registry',
    'cms_sections',
    'cms_collections',
    'cms_services_catalog',
    'cms_booking_service_options',
    'cms_testimonials',
    'cms_doctors',
    'cms_blog_posts',
    'cms_announcements',
    'cms_navigation_links'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', v_table || '_audit_log_trigger', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cms_log_change()',
      v_table || '_audit_log_trigger',
      v_table
    );
  END LOOP;
END
$$;

-- ------------------------------
-- updated_at triggers
-- ------------------------------
DROP TRIGGER IF EXISTS cms_media_assets_set_updated_at ON cms_media_assets;
CREATE TRIGGER cms_media_assets_set_updated_at
  BEFORE UPDATE ON cms_media_assets
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_site_globals_set_updated_at ON cms_site_globals;
CREATE TRIGGER cms_site_globals_set_updated_at
  BEFORE UPDATE ON cms_site_globals
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_page_registry_set_updated_at ON cms_page_registry;
CREATE TRIGGER cms_page_registry_set_updated_at
  BEFORE UPDATE ON cms_page_registry
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_sections_set_updated_at ON cms_sections;
CREATE TRIGGER cms_sections_set_updated_at
  BEFORE UPDATE ON cms_sections
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_collections_set_updated_at ON cms_collections;
CREATE TRIGGER cms_collections_set_updated_at
  BEFORE UPDATE ON cms_collections
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_services_catalog_set_updated_at ON cms_services_catalog;
CREATE TRIGGER cms_services_catalog_set_updated_at
  BEFORE UPDATE ON cms_services_catalog
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_booking_service_options_set_updated_at ON cms_booking_service_options;
CREATE TRIGGER cms_booking_service_options_set_updated_at
  BEFORE UPDATE ON cms_booking_service_options
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_testimonials_set_updated_at ON cms_testimonials;
CREATE TRIGGER cms_testimonials_set_updated_at
  BEFORE UPDATE ON cms_testimonials
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_doctors_set_updated_at ON cms_doctors;
CREATE TRIGGER cms_doctors_set_updated_at
  BEFORE UPDATE ON cms_doctors
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_blog_posts_set_updated_at ON cms_blog_posts;
CREATE TRIGGER cms_blog_posts_set_updated_at
  BEFORE UPDATE ON cms_blog_posts
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_announcements_set_updated_at ON cms_announcements;
CREATE TRIGGER cms_announcements_set_updated_at
  BEFORE UPDATE ON cms_announcements
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

DROP TRIGGER IF EXISTS cms_navigation_links_set_updated_at ON cms_navigation_links;
CREATE TRIGGER cms_navigation_links_set_updated_at
  BEFORE UPDATE ON cms_navigation_links
  FOR EACH ROW EXECUTE FUNCTION cms_set_updated_at();

-- ------------------------------
-- RLS
-- ------------------------------
ALTER TABLE cms_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_site_globals ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_page_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_booking_service_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_navigation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_publish_audit_log ENABLE ROW LEVEL SECURITY;

-- Public read-only policies for content rendering
DROP POLICY IF EXISTS cms_public_read_media_assets ON cms_media_assets;
CREATE POLICY cms_public_read_media_assets ON cms_media_assets
  FOR SELECT TO anon, authenticated USING (deleted_at IS NULL);

DROP POLICY IF EXISTS cms_public_read_site_globals ON cms_site_globals;
CREATE POLICY cms_public_read_site_globals ON cms_site_globals
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS cms_public_read_page_registry ON cms_page_registry;
CREATE POLICY cms_public_read_page_registry ON cms_page_registry
  FOR SELECT TO anon, authenticated USING (status = 'published');

DROP POLICY IF EXISTS cms_public_read_sections ON cms_sections;
CREATE POLICY cms_public_read_sections ON cms_sections
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM cms_page_registry p
      WHERE p.id = cms_sections.page_id
        AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS cms_public_read_collections ON cms_collections;
CREATE POLICY cms_public_read_collections ON cms_collections
  FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS cms_public_read_services_catalog ON cms_services_catalog;
CREATE POLICY cms_public_read_services_catalog ON cms_services_catalog
  FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS cms_public_read_booking_service_options ON cms_booking_service_options;
CREATE POLICY cms_public_read_booking_service_options ON cms_booking_service_options
  FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS cms_public_read_testimonials ON cms_testimonials;
CREATE POLICY cms_public_read_testimonials ON cms_testimonials
  FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS cms_public_read_doctors ON cms_doctors;
CREATE POLICY cms_public_read_doctors ON cms_doctors
  FOR SELECT TO anon, authenticated USING (is_active = true);

DROP POLICY IF EXISTS cms_public_read_blog_posts ON cms_blog_posts;
CREATE POLICY cms_public_read_blog_posts ON cms_blog_posts
  FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND (published_at IS NULL OR published_at <= NOW())
  );

DROP POLICY IF EXISTS cms_public_read_announcements ON cms_announcements;
CREATE POLICY cms_public_read_announcements ON cms_announcements
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND (start_at IS NULL OR start_at <= NOW())
    AND (end_at IS NULL OR end_at >= NOW())
  );

DROP POLICY IF EXISTS cms_public_read_navigation_links ON cms_navigation_links;
CREATE POLICY cms_public_read_navigation_links ON cms_navigation_links
  FOR SELECT TO anon, authenticated USING (is_active = true);

-- Authenticated editor policies (JWT app_metadata.cms_role in editor/publisher/admin)
DROP POLICY IF EXISTS cms_editor_write_media_assets ON cms_media_assets;
CREATE POLICY cms_editor_write_media_assets ON cms_media_assets
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_site_globals ON cms_site_globals;
CREATE POLICY cms_editor_write_site_globals ON cms_site_globals
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_page_registry ON cms_page_registry;
CREATE POLICY cms_editor_write_page_registry ON cms_page_registry
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_sections ON cms_sections;
CREATE POLICY cms_editor_write_sections ON cms_sections
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_collections ON cms_collections;
CREATE POLICY cms_editor_write_collections ON cms_collections
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_services_catalog ON cms_services_catalog;
CREATE POLICY cms_editor_write_services_catalog ON cms_services_catalog
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_booking_service_options ON cms_booking_service_options;
CREATE POLICY cms_editor_write_booking_service_options ON cms_booking_service_options
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_testimonials ON cms_testimonials;
CREATE POLICY cms_editor_write_testimonials ON cms_testimonials
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_doctors ON cms_doctors;
CREATE POLICY cms_editor_write_doctors ON cms_doctors
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_blog_posts ON cms_blog_posts;
CREATE POLICY cms_editor_write_blog_posts ON cms_blog_posts
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_announcements ON cms_announcements;
CREATE POLICY cms_editor_write_announcements ON cms_announcements
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_navigation_links ON cms_navigation_links;
CREATE POLICY cms_editor_write_navigation_links ON cms_navigation_links
  FOR ALL TO authenticated
  USING (cms_is_editor())
  WITH CHECK (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_read_audit_log ON cms_publish_audit_log;
CREATE POLICY cms_editor_read_audit_log ON cms_publish_audit_log
  FOR SELECT TO authenticated
  USING (cms_is_editor());

DROP POLICY IF EXISTS cms_editor_write_audit_log ON cms_publish_audit_log;
CREATE POLICY cms_editor_write_audit_log ON cms_publish_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (cms_is_editor());

-- ------------------------------
-- Supabase Storage bucket for CMS assets
-- ------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('cms_assets', 'cms_assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS cms_assets_public_read ON storage.objects;
CREATE POLICY cms_assets_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'cms_assets');

DROP POLICY IF EXISTS cms_assets_editor_insert ON storage.objects;
CREATE POLICY cms_assets_editor_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cms_assets' AND cms_is_editor());

DROP POLICY IF EXISTS cms_assets_editor_update ON storage.objects;
CREATE POLICY cms_assets_editor_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cms_assets' AND cms_is_editor())
  WITH CHECK (bucket_id = 'cms_assets' AND cms_is_editor());

DROP POLICY IF EXISTS cms_assets_editor_delete ON storage.objects;
CREATE POLICY cms_assets_editor_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cms_assets' AND cms_is_editor());