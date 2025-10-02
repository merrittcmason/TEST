/*
  # Auto-Provision User Profiles on Signup

  ## Overview
  Creates a database trigger that automatically provisions user profiles in the public.users table
  when a new user signs up through Supabase Auth. This eliminates the need for client-side profile
  creation and prevents race conditions.

  ## Changes

  1. New Function: `handle_new_user()`
     - Triggered automatically when a new row is inserted into auth.users
     - Creates a corresponding profile in public.users with:
       - id from auth.users
       - email from auth.users
       - name from auth.users.raw_user_meta_data (if available)
       - plan_type set to 'free' by default
     - Initializes token_usage record with 500 token limit (free plan default)
     - Initializes upload_quotas record with 1 upload limit (free plan default)
     - Uses current month (YYYY-MM-01 format) for quota tracking

  2. New Trigger: `on_auth_user_created`
     - Fires AFTER INSERT on auth.users table
     - Executes handle_new_user() function for each new user
     - Runs automatically without any client-side intervention

  ## Security Notes

  - The trigger runs with the privileges of the function definer (SECURITY DEFINER)
  - This allows it to bypass RLS policies that would normally prevent direct inserts
  - Quota limits are set based on free plan defaults; upgrades handled separately via backend

  ## Important Notes

  - This migration is idempotent - safe to run multiple times
  - Existing users are not affected; only applies to new signups
  - Profile creation happens atomically within the auth signup transaction
  - If any step fails, the entire signup is rolled back
*/

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  current_month date;
BEGIN
  -- Calculate current month in YYYY-MM-01 format
  current_month := date_trunc('month', CURRENT_DATE)::date;

  -- Insert user profile with free plan as default
  INSERT INTO public.users (id, email, name, plan_type)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NULL),
    'free'
  );

  -- Initialize token usage for current month (free plan: 500 tokens)
  INSERT INTO public.token_usage (user_id, month, tokens_used, tokens_limit)
  VALUES (NEW.id, current_month, 0, 500);

  -- Initialize upload quota for current month (free plan: 1 upload)
  INSERT INTO public.upload_quotas (user_id, month, uploads_used, uploads_limit)
  VALUES (NEW.id, current_month, 0, 1);

  RETURN NEW;
END;
$$;

-- Drop trigger if it exists to make migration idempotent
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that fires on new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
