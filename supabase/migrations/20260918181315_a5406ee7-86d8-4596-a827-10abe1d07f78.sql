DROP TRIGGER IF EXISTS create_staff_profile_after_signup ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_staff_profile();