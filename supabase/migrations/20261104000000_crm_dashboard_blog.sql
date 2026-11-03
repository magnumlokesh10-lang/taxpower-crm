-- TaxPower CRM v2: lead source, blog permission and the blog_posts table.
-- Safe to run more than once.

-- 1. where a lead came from (website form, added by hand ...)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '';

-- 2. staff may be allowed to write and publish blog articles
ALTER TABLE public.staff_permissions
  ADD COLUMN IF NOT EXISTS can_manage_blog boolean NOT NULL DEFAULT false;

-- 3. helper used by the blog policies: admin, or staff with the blog permission
CREATE OR REPLACE FUNCTION private.can_manage_blog(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.has_role(_user_id, 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.staff_permissions sp
        WHERE sp.user_id = _user_id AND sp.can_manage_blog
      )
$$;
REVOKE ALL ON FUNCTION private.can_manage_blog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_blog(uuid) TO authenticated, service_role;

-- 4. blog articles written in the CRM
DO $$ BEGIN
  CREATE TYPE public.blog_status AS ENUM ('draft', 'published');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.blog_status NOT NULL DEFAULT 'draft',
  title text NOT NULL DEFAULT '',
  h1 text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Guide',
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  related text[] NOT NULL DEFAULT '{}',
  cover_data text NOT NULL DEFAULT '',
  cover_alt text NOT NULL DEFAULT '',
  publish_date date,
  publish_time text NOT NULL DEFAULT '09:00',
  published_at timestamptz,
  author_id uuid,
  author_name text NOT NULL DEFAULT '',
  updated_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_posts TO authenticated;
GRANT ALL ON public.blog_posts TO service_role;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Blog managers read posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Blog managers add posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Blog managers edit posts" ON public.blog_posts;
DROP POLICY IF EXISTS "Blog managers delete posts" ON public.blog_posts;
CREATE POLICY "Blog managers read posts" ON public.blog_posts
  FOR SELECT TO authenticated USING (private.can_manage_blog(auth.uid()));
CREATE POLICY "Blog managers add posts" ON public.blog_posts
  FOR INSERT TO authenticated WITH CHECK (private.can_manage_blog(auth.uid()));
CREATE POLICY "Blog managers edit posts" ON public.blog_posts
  FOR UPDATE TO authenticated USING (private.can_manage_blog(auth.uid()))
  WITH CHECK (private.can_manage_blog(auth.uid()));
CREATE POLICY "Blog managers delete posts" ON public.blog_posts
  FOR DELETE TO authenticated USING (private.can_manage_blog(auth.uid()) AND status = 'draft');

DROP TRIGGER IF EXISTS blog_posts_touch_updated_at ON public.blog_posts;
CREATE TRIGGER blog_posts_touch_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
