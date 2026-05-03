UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"cms_role": "editor"}'::jsonb
WHERE id = 'user-id-of-cms-login';