import { supabase } from '../lib/supabase';
import type { Database } from '../lib/supabase';

type User = Database['public']['Tables']['users']['Row'];
type Event = Database['public']['Tables']['events']['Row'];
type TokenUsage = Database['public']['Tables']['token_usage']['Row'];
type UploadQuota = Database['public']['Tables']['upload_quotas']['Row'];
type Subscription = Database['public']['Tables']['subscriptions']['Row'];

export class DatabaseService {
  static async getUser(userId: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  static async createUser(
    userId: string,
    email: string,
    name?: string
  ): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .insert({ id: userId, email, name })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async updateUser(
    userId: string,
    updates: Database['public']['Tables']['users']['Update']
  ): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

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

    if (startDate) {
      query = query.gte('date', startDate);
    }
    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  static async createEvent(
    event: Database['public']['Tables']['events']['Insert']
  ): Promise<Event> {
    const { data, error } = await supabase
      .from('events')
      .insert(event)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async createEvents(
    events: Database['public']['Tables']['events']['Insert'][]
  ): Promise<Event[]> {
    const { data, error } = await supabase
      .from('events')
      .insert(events)
      .select();

    if (error) throw error;
    return data;
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
      return data;
    } else {
      const { data, error } = await supabase
        .from('token_usage')
        .insert({ user_id: userId, month, tokens_used: tokensUsed, tokens_limit: tokensLimit })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  }

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
      return data;
    } else {
      const { data, error } = await supabase
        .from('upload_quotas')
        .insert({ user_id: userId, month, uploads_used: uploadsUsed, uploads_limit: uploadsLimit })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  }

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
    return data;
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
    return data;
  }
}
