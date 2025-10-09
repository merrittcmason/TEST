import { supabase } from '../lib/supabase'
import type { Database } from '../lib/supabase'

type User = Database['public']['Tables']['users']['Row']
type Event = Database['public']['Tables']['events']['Row']
type EventInsert = Database['public']['Tables']['events']['Insert']
type EventUpdate = Database['public']['Tables']['events']['Update']
type TokenUsage = Database['public']['Tables']['token_usage']['Row']
type UploadQuota = Database['public']['Tables']['upload_quotas']['Row']
type Subscription = Database['public']['Tables']['subscriptions']['Row']
type DraftEventRow = Database['public']['Tables']['draft_events']['Row']
type DraftEventInsert = Database['public']['Tables']['draft_events']['Insert']

async function getCurrentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('Not authenticated')
  return user.id
}

export class DatabaseService {
  static async getUser(userId: string): Promise<User | null> {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle()
    if (error) throw error
    return data
  }

  static async updateUser(userId: string, updates: Database['public']['Tables']['users']['Update']): Promise<User> {
    const { data, error } = await supabase.from('users').update(updates).eq('id', userId).select().single()
    if (error) throw error
    return data
  }

  static async updateUserPreferences(userId: string, prefs: { timezone_preference?: string | null, time_format_preference?: string | null }): Promise<User> {
    const { data, error } = await supabase.from('users').update(prefs).eq('id', userId).select().single()
    if (error) throw error
    return data
  }

  static async getEvents(userId: string, startDate?: string, endDate?: string, label?: string): Promise<Event[]> {
    let query = supabase.from('events').select('*').eq('user_id', userId).order('start_date', { ascending: true }).order('start_time', { ascending: true })
    if (startDate) query = query.gte('start_date', startDate)
    if (endDate) query = query.lte('end_date', endDate)
    if (label) query = query.eq('label', label)
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  static async createEvent(event: EventInsert): Promise<Event> {
    let payload = { ...event } as EventInsert
    if (!payload.user_id) payload.user_id = await getCurrentUserId()
    const { data, error } = await supabase.from('events').insert(payload).select().single()
    if (error) throw error
    return data as Event
  }

  static async createEvents(events: EventInsert[]): Promise<Event[]> {
    const uid = await getCurrentUserId()
    const payload = events.map(e => ({ ...e, user_id: e.user_id ?? uid })) as EventInsert[]
    const { data, error } = await supabase.from('events').insert(payload).select()
    if (error) throw error
    return (data || []) as Event[]
  }

  static async updateEvent(eventId: string, updates: EventUpdate): Promise<Event> {
    const { data, error } = await supabase.from('events').update(updates).eq('id', eventId).select().single()
    if (error) throw error
    return data as Event
  }

  static async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase.from('events').delete().eq('id', eventId)
    if (error) throw error
  }

  static async getTokenUsage(userId: string, month: string): Promise<TokenUsage | null> {
    const { data, error } = await supabase.from('token_usage').select('*').eq('user_id', userId).eq('month', month).maybeSingle()
    if (error) throw error
    return data
  }

  static async getUploadQuota(userId: string, month: string): Promise<UploadQuota | null> {
    const { data, error } = await supabase.from('upload_quotas').select('*').eq('user_id', userId).eq('month', month).maybeSingle()
    if (error) throw error
    return data
  }

  static async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle()
    if (error) throw error
    return data
  }

  static async updateUserMode(userId: string, mode: string): Promise<User> {
    const { data, error } = await supabase.from('users').update({ mode }).eq('id', userId).select().single()
    if (error) throw error
    return data as User
  }

  static async replaceDraftEvents(userId: string, drafts: DraftEventInsert[]): Promise<DraftEventRow[]> {
    const { error: delErr } = await supabase.from('draft_events').delete().eq('user_id', userId)
    if (delErr) throw delErr
    if (!drafts.length) return []
    const uid = await getCurrentUserId()
    const payload = drafts.map(d => ({ ...d, user_id: d.user_id ?? uid })) as DraftEventInsert[]
    const { data, error: insErr } = await supabase.from('draft_events').insert(payload).select()
    if (insErr) throw insErr
    return (data || []) as DraftEventRow[]
  }

  static async getDraftEvents(userId: string): Promise<DraftEventRow[]> {
    const { data, error } = await supabase.from('draft_events').select('*').eq('user_id', userId).order('created_at', { ascending: true })
    if (error) throw error
    return (data || []) as DraftEventRow[]
  }

  static async clearDraftEvents(userId: string): Promise<void> {
    const { error } = await supabase.from('draft_events').delete().eq('user_id', userId)
    if (error) throw error
  }
}
