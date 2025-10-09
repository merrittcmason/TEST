import { supabase } from '../lib/supabase';
import type { Database } from '../lib/supabase';

type User = Database['public']['Tables']['users']['Row'];
type UserUpdate = Database['public']['Tables']['users']['Update'];
type Event = Database['public']['Tables']['events']['Row'];
type EventInsert = Database['public']['Tables']['events']['Insert'];
type EventUpdate = Database['public']['Tables']['events']['Update'];
type TokenUsage = Database['public']['Tables']['token_usage']['Row'];
type UploadQuota = Database['public']['Tables']['upload_quotas']['Row'];
type Subscription = Database['public']['Tables']['subscriptions']['Row'];
type DraftEventRow = Database['public']['Tables']['draft_events']['Row'];
type DraftEventInsert = Database['public']['Tables']['draft_events']['Insert'];

type UserPrefs = {
  user_id: string;
  timezone_preference: string | null;
  time_format_preference: 'auto' | '12' | '24' | null;
  tz_mode: 'auto' | 'manual' | null;
  theme_preference: 'system' | 'light' | 'dark' | null;
  default_view: 'month' | 'week' | null;
  week_start: 'sunday' | 'monday' | null;
  reminders_enabled: boolean;
  daily_summary_enabled: boolean;
  mode: 'personal' | 'education' | 'business' | 'enterprise' | null;
  display_time_zone?: string | null;
  hour_cycle?: string | null;
  date_format?: string | null;
};

async function getCurrentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export class DatabaseService {
  static async getUser(userId: string): Promise<User | null> {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  static async updateUser(userId: string, updates: UserUpdate): Promise<User> {
    const { data, error } = await supabase.from('users').update(updates).eq('id', userId).select().single();
    if (error) throw error;
    return data;
  }

  static async markProfileCompleted(userId: string, value: boolean): Promise<User> {
    const { data, error } = await supabase.from('users').update({ profile_completed: value }).eq('id', userId).select().single();
    if (error) throw error;
    return data;
  }

  static async upsertUsername(userId: string, username: string): Promise<User> {
    const { data, error } = await supabase.from('users').update({ username }).eq('id', userId).select().single();
    if (error) throw error;
    return data;
  }

  static async getUserPreferences(userId: string): Promise<UserPrefs | null> {
    const { data, error } = await supabase.from('user_prefs').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data as any;
  }

  static async updateUserPreferences(userId: string, updates: Partial<UserPrefs>): Promise<UserPrefs> {
    const existing = await this.getUserPreferences(userId);
    if (!existing) {
      const insertPayload = { user_id: userId, ...updates } as any;
      const { data, error } = await supabase.from('user_prefs').insert(insertPayload).select().single();
      if (error) throw error;
      return data as any;
    }
    const { data, error } = await supabase.from('user_prefs').update(updates as any).eq('user_id', userId).select().single();
    if (error) throw error;
    return data as any;
  }

  static async getEvents(userId: string, startDate?: string, endDate?: string, label?: string): Promise<Event[]> {
    let query = supabase.from('events').select('*').eq('user_id', userId).order('start_date', { ascending: true }).order('start_time', { ascending: true, nullsFirst: false });
    if (startDate) query = query.gte('start_date', startDate);
    if (endDate) query = query.lte('end_date', endDate);
    if (label) query = query.eq('label', label);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  static async getAvailableLabels(userId: string): Promise<string[]> {
    const { data, error } = await supabase.from('events').select('label').eq('user_id', userId).not('label', 'is', null);
    if (error) throw error;
    const set = new Set<string>();
    for (const r of data || []) {
      const v = (r as any).label as string | null;
      if (v && v.trim()) set.add(v.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  static async createEvent(event: EventInsert): Promise<Event> {
    let payload = { ...event } as EventInsert;
    if (!payload.user_id) {
      const uid = await getCurrentUserId();
      payload.user_id = uid;
    }
    const { data, error } = await supabase.from('events').insert(payload).select().single();
    if (error) throw error;
    return data as Event;
  }

  static async createEvents(events: EventInsert[]): Promise<Event[]> {
    const uid = await getCurrentUserId();
    const payload = events.map(e => ({ ...e, user_id: e.user_id ?? uid })) as EventInsert[];
    const { data, error } = await supabase.from('events').insert(payload).select();
    if (error) throw error;
    return (data || []) as Event[];
  }

  static async updateEvent(eventId: string, updates: EventUpdate): Promise<Event> {
    const { data, error } = await supabase.from('events').update(updates).eq('id', eventId).select().single();
    if (error) throw error;
    return data as Event;
  }

  static async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    if (error) throw error;
  }

  static async getTokenUsage(userId: string, month: string): Promise<TokenUsage | null> {
    const { data, error } = await supabase.from('token_usage').select('*').eq('user_id', userId).eq('month', month).maybeSingle();
    if (error) throw error;
    return data;
  }

  static async getUploadQuota(userId: string, month: string): Promise<UploadQuota | null> {
    const { data, error } = await supabase.from('upload_quotas').select('*').eq('user_id', userId).eq('month', month).maybeSingle();
    if (error) throw error;
    return data;
  }

  static async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (error) throw error;
    return data;
  }

  static async createSubscription(subscription: Database['public']['Tables']['subscriptions']['Insert']): Promise<Subscription> {
    const { data, error } = await supabase.from('subscriptions').insert(subscription).select().single();
    if (error) throw error;
    return data as Subscription;
  }

  static async updateSubscription(subscriptionId: string, updates: Database['public']['Tables']['subscriptions']['Update']): Promise<Subscription> {
    const { data, error } = await supabase.from('subscriptions').update(updates).eq('id', subscriptionId).select().single();
    if (error) throw error;
    return data as Subscription;
  }

  static async replaceDraftEvents(userId: string, drafts: DraftEventInsert[]): Promise<DraftEventRow[]> {
    const { error: delErr } = await supabase.from('draft_events').delete().eq('user_id', userId);
    if (delErr) throw delErr;
    if (!drafts.length) return [];
    const uid = await getCurrentUserId();
    const payload = drafts.map(d => ({ ...d, user_id: d.user_id ?? uid })) as DraftEventInsert[];
    const { data, error: insErr } = await supabase.from('draft_events').insert(payload).select();
    if (insErr) throw insErr;
    return (data || []) as DraftEventRow[];
  }

  static async getDraftEvents(userId: string): Promise<DraftEventRow[]> {
    const { data, error } = await supabase.from('draft_events').select('*').eq('user_id', userId).order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []) as DraftEventRow[];
  }

  static async clearDraftEvents(userId: string): Promise<void> {
    const { error } = await supabase.from('draft_events').delete().eq('user_id', userId);
    if (error) throw error;
  }

  static async createDraftEvents(drafts: DraftEventInsert[]): Promise<DraftEventRow[]> {
    const uid = await getCurrentUserId();
    const payload = drafts.map(e => ({ ...e, user_id: e.user_id ?? uid })) as DraftEventInsert[];
    const { data, error } = await supabase.from('draft_events').insert(payload).select();
    if (error) throw error;
    return (data || []) as DraftEventRow[];
  }
}
