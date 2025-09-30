import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          plan_type: 'free' | 'student' | 'pro';
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          plan_type?: 'free' | 'student' | 'pro';
          stripe_customer_id?: string | null;
        };
        Update: {
          name?: string | null;
          plan_type?: 'free' | 'student' | 'pro';
          stripe_customer_id?: string | null;
        };
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan: 'student' | 'pro';
          stripe_subscription_id: string | null;
          status: 'active' | 'canceled' | 'past_due' | 'trialing';
          current_period_start: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          plan: 'student' | 'pro';
          stripe_subscription_id?: string | null;
          status: 'active' | 'canceled' | 'past_due' | 'trialing';
          current_period_start?: string | null;
          current_period_end?: string | null;
        };
        Update: {
          status?: 'active' | 'canceled' | 'past_due' | 'trialing';
          current_period_start?: string | null;
          current_period_end?: string | null;
        };
      };
      events: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          date: string;
          time: string | null;
          all_day: boolean;
          tag: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          name: string;
          date: string;
          time?: string | null;
          all_day?: boolean;
          tag?: string | null;
        };
        Update: {
          name?: string;
          date?: string;
          time?: string | null;
          all_day?: boolean;
          tag?: string | null;
        };
      };
      token_usage: {
        Row: {
          id: string;
          user_id: string;
          month: string;
          tokens_used: number;
          tokens_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          month: string;
          tokens_used?: number;
          tokens_limit: number;
        };
        Update: {
          tokens_used?: number;
          tokens_limit?: number;
        };
      };
      upload_quotas: {
        Row: {
          id: string;
          user_id: string;
          month: string;
          uploads_used: number;
          uploads_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          month: string;
          uploads_used?: number;
          uploads_limit: number;
        };
        Update: {
          uploads_used?: number;
          uploads_limit?: number;
        };
      };
    };
  };
};
