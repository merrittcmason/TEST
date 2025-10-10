import { supabase } from '../lib/supabase';
import type { Database } from '../lib/supabase';

type User = Database['public']['Tables']['users']['Row'];
type UserInsert = Database['public']['Tables']['users']['Insert'];
type UserUpdate = Database['public']['Tables']['users']['Update'];
type Event = Database['public']['Tables']['events']['Row'];
type EventInsert = Database['public']['Tables']['events']['Insert'];
type EventUpdate = Database['public']['Tables']['events']['Update'];
type TokenUsage = Database['public']['Tables']['token_usage']['Row'];
type UploadQuota = Database['public']['Tables']['upload_quotas']['Row'];
type Subscription = Database['public']['Tables']['subscriptions']['Row'];
type SubscriptionInsert = Database['public']['Tables']['subscriptions']['Insert'];
type SubscriptionUpdate = Database['public']['Tables']['subscriptions']['Update'];
type DraftEventRow = Database['public']['Tables']['draft_events']['Row'];
type DraftEventInsert = Database['public']['Tables']['draft_events']['Insert'];
type UserPrefsRow = Database['public']['Tables']['user_prefs']['Row'];
type UserPrefsInsert = Database['public']['Tables']['user_prefs']['Insert'];
type UserPrefsUpdate = Database['public']['Tables']['user_prefs']['Update'];

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

  static async getUserPreferences(userId: string): Promise<UserPrefsRow | null> {
    const { data, error } = await supabase.from('user_prefs').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  static async updateUserPreferences(userId: string, updates: UserPrefsUpdate): Promise<UserPrefsRow> {
    const existing = await this.getUserPreferences(userId);
    if (!existing) {
      const insertPayload: UserPrefsInsert = { user_id: userId, ...updates };
      const { data, error } = await supabase.from('user_prefs').insert(insertPayload).select().single();
      if (error) throw error;
      return data as UserPrefsRow;
    }
    const { data, error } = await supabase.from('user_prefs').update(updates).eq('user_id', userId).select().single();
    if (error) throw error;
    return data as UserPrefsRow;
  }

  static async ensureUserRecord(userId: string): Promise<void> {
    const { data: existing, error: selErr } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
    if (selErr) throw selErr;
    if (existing) return;
    const { data: gu } = await supabase.auth.getUser();
    const email = gu?.user?.email ?? null;
    const now = new Date().toISOString();
    const payload: UserInsert = {
      id: userId,
      email,
      plan_type: 'free',
      profile_completed: false,
      first_login_at: now,
      last_login_at: now
    };
    const { error: insErr } = await supabase.from('users').insert(payload);
    if (insErr) throw insErr;
  }

  static async upsertUserOnSignup(input: {
    email: string;
    username: string;
    dob: string | null;
    marketingOptIn: boolean;
    tosAgreed: boolean;
    privacyAgreed: boolean;
    provider: 'password' | 'google' | 'github' | 'apple';
  }): Promise<User> {
    const uid = await getCurrentUserId();
    const now = new Date().toISOString();
    const { data: existing, error: selErr } = await supabase.from('users').select('id, first_login_at').eq('id', uid).maybeSingle();
    if (selErr) throw selErr;
    if (!existing) {
      const insertPayload: UserInsert = {
        id: uid,
        email: input.email,
        username: input.username || null,
        dob: input.dob,
        plan_type: 'free',
        marketing_opt_in: !!input.marketingOptIn,
        tos_agreed_at: input.tosAgreed ? now : null,
        privacy_agreed_at: input.privacyAgreed ? now : null,
        account_provider: input.provider,
        profile_completed: false,
        first_login_at: now,
        last_login_at: now
      };
      const { data, error } = await supabase.from('users').insert(insertPayload).select().single();
      if (error) throw error;
      return data as User;
    }
    const updatePayload: UserUpdate = {
      email: input.email,
      username: input.username || null,
      dob: input.dob,
      plan_type: 'free',
      marketing_opt_in: !!input.marketingOptIn,
      tos_agreed_at: input.tosAgreed ? now : null,
      privacy_agreed_at: input.privacyAgreed ? now : null,
      account_provider: input.provider,
      profile_completed: false,
      last_login_at: now
    };
    const { data, error } = await supabase.from('users').update(updatePayload).eq('id', uid).select().single();
    if (error) throw error;
    return data as User;
  }

  static async upsertUserOnSignupWithId(params: {
    userId: string;
    email: string | null;
    username: string | null;
    dob: string | null;
    marketingOptIn: boolean;
    tosAgreed: boolean;
    privacyAgreed: boolean;
    provider: 'password' | 'google' | 'github' | 'apple';
  }): Promise<User> {
    const now = new Date().toISOString();
    const { data: existing, error: selErr } = await supabase.from('users').select('id, first_login_at').eq('id', params.userId).maybeSingle();
    if (selErr) throw selErr;
    if (!existing) {
      const insertPayload: UserInsert = {
        id: params.userId,
        email: params.email,
        username: params.username,
        dob: params.dob,
        plan_type: 'free',
        marketing_opt_in: !!params.marketingOptIn,
        tos_agreed_at: params.tosAgreed ? now : null,
        privacy_agreed_at: params.privacyAgreed ? now : null,
        account_provider: params.provider,
        profile_completed: false,
        first_login_at: now,
        last_login_at: now
      };
      const { data, error } = await supabase.from('users').insert(insertPayload).select().single();
      if (error) throw error;
      return data as User;
    }
    const updatePayload: UserUpdate = {
      email: params.email,
      username: params.username,
      dob: params.dob,
      plan_type: 'free',
      marketing_opt_in: !!params.marketingOptIn,
      tos_agreed_at: params.tosAgreed ? now : null,
      privacy_agreed_at: params.privacyAgreed ? now : null,
      account_provider: params.provider,
      profile_completed: false,
      last_login_at: now
    };
    const { data, error } = await supabase.from('users').update(updatePayload).eq('id', params.userId).select().single();
    if (error) throw error;
    return data as User;
  }

  static async touchLastLogin(userId: string): Promise<void> {
    const { error } = await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', userId);
    if (error) throw error;
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

  static async createSubscription(subscription: SubscriptionInsert): Promise<Subscription> {
    const { data, error } = await supabase.from('subscriptions').insert(subscription).select().single();
    if (error) throw error;
    return data as Subscription;
  }

  static async updateSubscription(subscriptionId: string, updates: SubscriptionUpdate): Promise<Subscription> {
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
