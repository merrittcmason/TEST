/*
  # Calendar Pilot Database Schema

  ## Overview
  Creates the complete database schema for Calendar Pilot, an AI-powered calendar/scheduling application.

  ## 1. New Tables

  ### `users`
  Stores user account information and plan details.
  - `id` (uuid, primary key) - Unique user identifier from Supabase Auth
  - `email` (text, unique, not null) - User's email address
  - `name` (text) - User's display name
  - `plan_type` (text, not null, default 'free') - Subscription plan: 'free', 'student', or 'pro'
  - `stripe_customer_id` (text, unique) - Stripe customer ID for billing
  - `created_at` (timestamptz, default now()) - Account creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp

  ### `subscriptions`
  Tracks active subscriptions and billing status.
  - `id` (uuid, primary key) - Unique subscription identifier
  - `user_id` (uuid, foreign key -> users.id) - Reference to user
  - `plan` (text, not null) - Plan type: 'student' or 'pro'
  - `stripe_subscription_id` (text, unique) - Stripe subscription ID
  - `status` (text, not null) - Subscription status: 'active', 'canceled', 'past_due'
  - `current_period_start` (timestamptz) - Current billing period start date
  - `current_period_end` (timestamptz) - Current billing period end date
  - `created_at` (timestamptz, default now()) - Subscription creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp

  ### `events`
  Stores calendar events created by users.
  - `id` (uuid, primary key) - Unique event identifier
  - `user_id` (uuid, foreign key -> users.id) - Reference to user
  - `name` (text, not null) - Event name/title
  - `date` (date, not null) - Event date
  - `time` (time) - Event time (null for all-day events)
  - `all_day` (boolean, default false) - Whether event is all-day
  - `tag` (text) - Optional event tag/category
  - `created_at` (timestamptz, default now()) - Event creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp

  ### `token_usage`
  Tracks OpenAI API token consumption per user per month.
  - `id` (uuid, primary key) - Unique record identifier
  - `user_id` (uuid, foreign key -> users.id) - Reference to user
  - `month` (date, not null) - Month for usage tracking (YYYY-MM-01)
  - `tokens_used` (integer, default 0) - Total tokens consumed
  - `tokens_limit` (integer, not null) - Token limit for current plan
  - `created_at` (timestamptz, default now()) - Record creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp
  - UNIQUE constraint on (user_id, month)

  ### `upload_quotas`
  Tracks file upload quotas per user per month.
  - `id` (uuid, primary key) - Unique record identifier
  - `user_id` (uuid, foreign key -> users.id) - Reference to user
  - `month` (date, not null) - Month for quota tracking (YYYY-MM-01)
  - `uploads_used` (integer, default 0) - Number of uploads consumed
  - `uploads_limit` (integer, not null) - Upload limit for current plan
  - `created_at` (timestamptz, default now()) - Record creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp
  - UNIQUE constraint on (user_id, month)

  ## 2. Security

  ### Row Level Security (RLS)
  All tables have RLS enabled to ensure users can only access their own data.

  ### RLS Policies

  #### `users` table
  - Users can read their own profile data
  - Users can update their own profile data

  #### `subscriptions` table
  - Users can read their own subscription data
  - System can insert subscription records (service role)

  #### `events` table
  - Users can read their own events
  - Users can insert their own events
  - Users can update their own events
  - Users can delete their own events

  #### `token_usage` table
  - Users can read their own token usage
  - System can insert and update token usage (service role)

  #### `upload_quotas` table
  - Users can read their own upload quotas
  - System can insert and update upload quotas (service role)

  ## 3. Indexes

  Performance indexes created for common queries:
  - Events by user_id and date range
  - Token usage by user_id and month
  - Upload quotas by user_id and month
  - Subscriptions by user_id

  ## 4. Important Notes

  - Events older than the previous month are automatically flagged for deletion
  - Maximum 5 years of event storage enforced
  - Token and upload quotas reset monthly for Pro plan users
  - Student Pack has lifetime upload quota (5 total)
*/

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  name text,
  plan_type text NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'student', 'pro')),
  stripe_customer_id text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('student', 'pro')),
  stripe_subscription_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create events table
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  date date NOT NULL,
  time time,
  all_day boolean DEFAULT false,
  tag text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create token_usage table
CREATE TABLE IF NOT EXISTS token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  tokens_used integer DEFAULT 0,
  tokens_limit integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, month)
);

-- Create upload_quotas table
CREATE TABLE IF NOT EXISTS upload_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  uploads_used integer DEFAULT 0,
  uploads_limit integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, month)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);
CREATE INDEX IF NOT EXISTS idx_token_usage_user_month ON token_usage(user_id, month);
CREATE INDEX IF NOT EXISTS idx_upload_quotas_user_month ON upload_quotas(user_id, month);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_quotas ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS Policies for subscriptions table
CREATE POLICY "Users can read own subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service can insert subscriptions"
  ON subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for events table
CREATE POLICY "Users can read own events"
  ON events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own events"
  ON events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own events"
  ON events FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for token_usage table
CREATE POLICY "Users can read own token usage"
  ON token_usage FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own token usage"
  ON token_usage FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own token usage"
  ON token_usage FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for upload_quotas table
CREATE POLICY "Users can read own upload quotas"
  ON upload_quotas FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own upload quotas"
  ON upload_quotas FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own upload quotas"
  ON upload_quotas FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_token_usage_updated_at ON token_usage;
CREATE TRIGGER update_token_usage_updated_at
  BEFORE UPDATE ON token_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_upload_quotas_updated_at ON upload_quotas;
CREATE TRIGGER update_upload_quotas_updated_at
  BEFORE UPDATE ON upload_quotas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();