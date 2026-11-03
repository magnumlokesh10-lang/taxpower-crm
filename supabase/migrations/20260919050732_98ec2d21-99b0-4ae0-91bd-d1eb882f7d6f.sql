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