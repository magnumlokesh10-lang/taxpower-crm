-- TaxPower CRM: complete database for a NEW Supabase project.
-- Run this once in Supabase -> SQL editor (it is every migration in order, ending with the blog tables).
-- Then create your admin: see "Make the first administrator" at the bottom of this file.

-- ===== 20260918165731_6901728d-f0e6-49d0-bd1e-8c566d9a2020.sql =====
create type public.lead_status as enum ('new', 'contacted', 'converted', 'closed');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  submitted_at_text text not null default '',
  name text not null default '',
  company text not null default '',
  mobile text not null default '',
  email text not null default '',
  gstin text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  product text not null default '',
  purpose text not null default '',
  page text not null default '',
  status public.lead_status not null default 'new',
  notes text not null default '',
  followup_date date,
  followup_note text not null default '',
  converted_at timestamptz,
  purchase_product text not null default '',
  purchase_amount numeric,
  invoice_no text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;

alter table public.leads enable row level security;

create policy "signed in users manage leads"
on public.leads for all to authenticated
using (true) with check (true);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_touch_updated_at
before update on public.leads
for each row execute function public.touch_updated_at();

-- ===== 20260918181132_a879e118-a3d0-477f-929b-2839315a7b03.sql =====
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Staff can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_staff_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', split_part(COALESCE(new.email, ''), '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE TRIGGER create_staff_profile_after_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_staff_profile();

CREATE TRIGGER profiles_touch_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== 20260918181144_655686ac-7686-482b-a02b-fc9f7372afb1.sql =====
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_staff_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_staff_profile() TO service_role;

-- ===== 20260918181208_cc8caaa3-836f-4ae8-952a-a61638f82149.sql =====
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS "signed in users manage leads" ON public.leads;
CREATE POLICY "Admins can view leads" ON public.leads FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can add leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update leads" ON public.leads FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete leads" ON public.leads FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'));

DROP FUNCTION public.has_role(uuid, public.app_role);

-- ===== 20260918181315_a5406ee7-86d8-4596-a827-10abe1d07f78.sql =====
DROP TRIGGER IF EXISTS create_staff_profile_after_signup ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_staff_profile();

-- ===== 20260919045231_b7d4914b-e0ae-46ff-8a6d-7466ec1187c3.sql =====
DROP POLICY IF EXISTS "Admins can view leads" ON public.leads;
DROP POLICY IF EXISTS "Admins can update leads" ON public.leads;

CREATE POLICY "Staff and admins can view leads"
ON public.leads FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admins can update leads"
ON public.leads FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'staff'::app_role));

-- ===== 20260919050732_98ec2d21-99b0-4ae0-91bd-d1eb882f7d6f.sql =====
-- 1. updated-by tracking on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by_name text NOT NULL DEFAULT '';

-- 2. staff permissions
CREATE TABLE public.staff_permissions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  can_add_leads boolean NOT NULL DEFAULT false,
  can_edit_leads boolean NOT NULL DEFAULT true,
  can_convert_leads boolean NOT NULL DEFAULT true,
  can_export boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_permissions TO authenticated;
GRANT ALL ON public.staff_permissions TO service_role;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage staff permissions" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Staff can view own permissions" ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE TRIGGER staff_permissions_touch_updated_at
  BEFORE UPDATE ON public.staff_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. immutable activity history
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  lead_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  details text NOT NULL DEFAULT '',
  actor_id uuid,
  actor_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_lead_id_idx ON public.lead_activities(lead_id, created_at DESC);
GRANT SELECT ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff and admins can view activity" ON public.lead_activities
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'staff'::app_role));

-- 4. deleted lead archive
CREATE TABLE public.deleted_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  lead_name text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL,
  reason text NOT NULL DEFAULT '',
  deleted_by uuid,
  deleted_by_name text NOT NULL DEFAULT '',
  deleted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.deleted_leads TO authenticated;
GRANT ALL ON public.deleted_leads TO service_role;
ALTER TABLE public.deleted_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view deleted leads" ON public.deleted_leads
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can archive deleted leads" ON public.deleted_leads
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- 5. helper: display name of a user
CREATE OR REPLACE FUNCTION private.actor_name(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(p.display_name, ''), split_part(u.email, '@', 1), 'System')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = _user_id
$$;
REVOKE ALL ON FUNCTION private.actor_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.actor_name(uuid) TO authenticated, service_role;

-- 6. stamp updated_by + log activity on leads
CREATE OR REPLACE FUNCTION public.leads_track_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  who uuid := auth.uid();
  who_name text;
  changed text[] := '{}';
  act text;
BEGIN
  who_name := COALESCE(private.actor_name(who), 'Website');
  IF TG_OP = 'INSERT' THEN
    NEW.updated_by := who;
    NEW.updated_by_name := CASE WHEN who IS NULL THEN 'Website form' ELSE who_name END;
    INSERT INTO public.lead_activities (lead_id, lead_name, action, details, actor_id, actor_name)
    VALUES (NEW.id, NEW.name, 'created', 'Lead added', who, NEW.updated_by_name);
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN changed := changed || 'name'; END IF;
  IF NEW.company IS DISTINCT FROM OLD.company THEN changed := changed || 'company'; END IF;
  IF NEW.mobile IS DISTINCT FROM OLD.mobile THEN changed := changed || 'mobile'; END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN changed := changed || 'email'; END IF;
  IF NEW.gstin IS DISTINCT FROM OLD.gstin THEN changed := changed || 'GSTIN'; END IF;
  IF NEW.address IS DISTINCT FROM OLD.address THEN changed := changed || 'address'; END IF;
  IF NEW.city IS DISTINCT FROM OLD.city THEN changed := changed || 'city'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN changed := changed || 'state'; END IF;
  IF NEW.product IS DISTINCT FROM OLD.product THEN changed := changed || 'product'; END IF;
  IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN changed := changed || 'purpose'; END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN changed := changed || 'notes'; END IF;
  IF NEW.followup_date IS DISTINCT FROM OLD.followup_date THEN changed := changed || 'follow-up date'; END IF;
  IF NEW.followup_note IS DISTINCT FROM OLD.followup_note THEN changed := changed || 'follow-up remark'; END IF;
  IF NEW.purchase_product IS DISTINCT FROM OLD.purchase_product THEN changed := changed || 'purchased product'; END IF;
  IF NEW.purchase_amount IS DISTINCT FROM OLD.purchase_amount THEN changed := changed || 'amount'; END IF;
  IF NEW.invoice_no IS DISTINCT FROM OLD.invoice_no THEN changed := changed || 'invoice number'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN changed := changed || ('status: ' || OLD.status || ' to ' || NEW.status); END IF;

  IF array_length(changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.updated_by := who;
  NEW.updated_by_name := who_name;

  act := CASE WHEN NEW.status = 'converted' AND OLD.status IS DISTINCT FROM 'converted'
              THEN 'converted' ELSE 'updated' END;

  INSERT INTO public.lead_activities (lead_id, lead_name, action, details, actor_id, actor_name)
  VALUES (NEW.id, NEW.name, act, 'Changed ' || array_to_string(changed, ', '), who, who_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_track_changes ON public.leads;
CREATE TRIGGER leads_track_changes
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_track_changes();

-- 7. archive + log on delete (safety net, always runs)
CREATE OR REPLACE FUNCTION public.leads_archive_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  who uuid := auth.uid();
  who_name text := COALESCE(private.actor_name(auth.uid()), 'System');
  reason text := '';
BEGIN
  SELECT d.reason INTO reason
  FROM public.deleted_leads d
  WHERE d.lead_id = OLD.id
  ORDER BY d.deleted_at DESC
  LIMIT 1;

  IF reason IS NULL THEN
    INSERT INTO public.deleted_leads (lead_id, lead_name, snapshot, reason, deleted_by, deleted_by_name)
    VALUES (OLD.id, OLD.name, to_jsonb(OLD), '', who, who_name);
    reason := '';
  END IF;

  INSERT INTO public.lead_activities (lead_id, lead_name, action, details, actor_id, actor_name)
  VALUES (OLD.id, OLD.name, 'deleted',
          CASE WHEN reason = '' THEN 'Lead deleted' ELSE 'Lead deleted. Reason: ' || reason END,
          who, who_name);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS leads_archive_delete ON public.leads;
CREATE TRIGGER leads_archive_delete
  BEFORE DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_archive_delete();

-- 8. staff with permission may add leads; edit gated by permission
DROP POLICY IF EXISTS "Admins can add leads" ON public.leads;
CREATE POLICY "Admins and permitted staff can add leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR (private.has_role(auth.uid(), 'staff'::app_role)
        AND EXISTS (SELECT 1 FROM public.staff_permissions sp
                    WHERE sp.user_id = auth.uid() AND sp.can_add_leads))
  );

DROP POLICY IF EXISTS "Staff and admins can update leads" ON public.leads;
CREATE POLICY "Admins and permitted staff can update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR (private.has_role(auth.uid(), 'staff'::app_role)
        AND EXISTS (SELECT 1 FROM public.staff_permissions sp
                    WHERE sp.user_id = auth.uid() AND sp.can_edit_leads))
  )
  WITH CHECK (
    private.has_role(auth.uid(), 'admin'::app_role)
    OR (private.has_role(auth.uid(), 'staff'::app_role)
        AND EXISTS (SELECT 1 FROM public.staff_permissions sp
                    WHERE sp.user_id = auth.uid() AND sp.can_edit_leads))
  );

-- ===== 20260919050739_05b94aef-ee24-400a-bfd0-7a93ee383a7a.sql =====
REVOKE ALL ON FUNCTION public.leads_track_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leads_archive_delete() FROM PUBLIC, anon, authenticated;

-- ===== 20261104000000_crm_dashboard_blog.sql =====
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

-- ===== Make the first administrator =====
-- 1. Supabase -> Authentication -> Users -> Add user (your email + a password, tick "Auto Confirm User").
-- 2. Run this with your email:
--
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'you@example.com'
--   on conflict do nothing;
--   insert into public.staff_permissions (user_id, can_add_leads, can_edit_leads, can_convert_leads, can_export, can_manage_blog)
--   select id, true, true, true, true, true from auth.users where email = 'you@example.com'
--   on conflict (user_id) do update set can_manage_blog = true, can_add_leads = true;
--
-- After that you can sign in at crm.taxpower.co and create every other login from the Team page.
