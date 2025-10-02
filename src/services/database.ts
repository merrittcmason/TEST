import { supabase } from '../lib/supabase';
import type { Database } from '../lib/supabase';

type User = Database['public']['Tables']['users']['Row'];
type Event = Database['public']['Tables']['events']['Row'];
type TokenUsage = Database['public']['Tables']['token_usage']['Row'];
type UploadQuota = Database['public']['Tables']['upload_quotas']['Row'];
type Subscription = Database['public']['Tables']['subscriptions']['Row'];

async function getCurrentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export class DatabaseService {
  /** -------------------- USERS -------------------- */

  static async getUser(userId: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*') // includes plan_type per your schema
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Don’t call this from the client anymore.
   * Your DB trigger (on auth.users insert) should create the profile with plan_type='free'.
   * Leaving this here to avoid compile errors if referenced, but it throws to prevent misuse.
   */
  static async createUser(
    _userId: string,
    _email: string,
    _name?: string
  ): Promise<User> {
    throw new Error('createUser is disabled: profiles are created by DB trigger on signup');
  }

  static async updateUser(
    userId: string,
    updates: Database['public']['Tables']['users']['Update']
  ): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .update(updates) // e.g., updating name; plan_type should normally be changed via a controlled RPC
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /** -------------------- EVENTS -------------------- */

  static async getEvents(
    userId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Event[]> {
    let query = supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('time', { ascending: true, nullsFirst: false });

    if (startDate) query = query.gte('date', startDate);
    if (endDate)   query = query.lte('date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Ensures user_id is set to the current auth user to satisfy RLS:
   *   WITH CHECK (user_id = auth.uid())
   */
  static async createEvent(
    event: Database['public']['Tables']['events']['Insert']
  ): Promise<Event> {
    let payload = { ...event } as Database['public']['Tables']['events']['Insert'];

    if (!payload.user_id) {
      const uid = await getCurrentUserId();
      payload.user_id = uid;
    }

    const { data, error } = await supabase
      .from('events')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Bulk create; injects user_id for any items missing it.
   */
  static async createEvents(
    events: Database['public']['Tables']['events']['Insert'][]
  ): Promise<Event[]> {
    const uid = await getCurrentUserId();
    const payload = events.map(e => ({
      ...e,
      user_id: e.user_id ?? uid,
    })) as Database['public']['Tables']['events']['Insert'][];

    const { data, error } = await supabase
      .from('events')
      .insert(payload)
      .select();

    if (error) throw error;
    return data as Event[];
  }

  static async updateEvent(
    eventId: string,
    updates: Database['public']['Tables']['events']['Update']
  ): Promise<Event> {
    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);

    if (error) throw error;
  }

  /** -------------------- TOKEN USAGE --------------------
   * NOTE: If you tighten RLS (recommended), writes should be done from your backend using the service role.
   */

  static async getTokenUsage(userId: string, month: string): Promise<TokenUsage | null> {
    const { data, error } = await supabase
      .from('token_usage')
      .select('*')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  static async createOrUpdateTokenUsage(
    userId: string,
    month: string,
    tokensUsed: number,
    tokensLimit: number
  ): Promise<TokenUsage> {
    const existing = await this.getTokenUsage(userId, month);

    if (existing) {
      const { data, error } = await supabase
        .from('token_usage')
        .update({ tokens_used: tokensUsed })
        .eq('user_id', userId)
        .eq('month', month)
        .select()
        .single();

      if (error) throw error;
      return data as TokenUsage;
    } else {
      const { data, error } = await supabase
        .from('token_usage')
        .insert({ user_id: userId, month, tokens_used: tokensUsed, tokens_limit: tokensLimit })
        .select()
        .single();

      if (error) throw error;
      return data as TokenUsage;
    }
  }

  /** -------------------- UPLOAD QUOTAS --------------------
   * NOTE: Same service-role caveat as above if you harden RLS.
   */

  static async getUploadQuota(userId: string, month: string): Promise<UploadQuota | null> {
    const { data, error } = await supabase
      .from('upload_quotas')
      .select('*')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  static async createOrUpdateUploadQuota(
    userId: string,
    month: string,
    uploadsUsed: number,
    uploadsLimit: number
  ): Promise<UploadQuota> {
    const existing = await this.getUploadQuota(userId, month);

    if (existing) {
      const { data, error } = await supabase
        .from('upload_quotas')
        .update({ uploads_used: uploadsUsed })
        .eq('user_id', userId)
        .eq('month', month)
        .select()
        .single();

      if (error) throw error;
      return data as UploadQuota;
    } else {
      const { data, error } = await supabase
        .from('upload_quotas')
        .insert({ user_id: userId, month, uploads_used: uploadsUsed, uploads_limit: uploadsLimit })
        .select()
        .single();

      if (error) throw error;
      return data as UploadQuota;
    }
  }

  /** -------------------- SUBSCRIPTIONS --------------------
   * Strongly recommended: perform create/update from your backend with the service role,
   * since user-side writes should be restricted.
   */

  static async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  static async createSubscription(
    subscription: Database['public']['Tables']['subscriptions']['Insert']
  ): Promise<Subscription> {
    const { data, error } = await supabase
      .from('subscriptions')
      .insert(subscription)
      .select()
      .single();

    if (error) throw error;
    return data as Subscription;
  }

  static async updateSubscription(
    subscriptionId: string,
    updates: Database['public']['Tables']['subscriptions']['Update']
  ): Promise<Subscription> {
    const { data, error } = await supabase
      .from('subscriptions')
      .update(updates)
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error) throw error;
    return data as Subscription;
  }
}
