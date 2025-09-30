import { supabase } from '../lib/supabase';
import { DatabaseService } from './database';
import type { User } from '@supabase/supabase-js';

export class AuthService {
  static async signUp(email: string, password: string, name?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) throw error;
    if (!data.user) throw new Error('Failed to create user');

    await DatabaseService.createUser(data.user.id, email, name);

    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
    await DatabaseService.createOrUpdateTokenUsage(data.user.id, currentMonth, 0, 500);
    await DatabaseService.createOrUpdateUploadQuota(data.user.id, currentMonth, 0, 1);

    return data;
  }

  static async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  }

  static async signInWithOAuth(provider: 'google' | 'github' | 'apple') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) throw error;
    return data;
  }

  static async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  static async getCurrentUser(): Promise<User | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  static async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
  }

  static async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
  }

  static onAuthStateChange(
    callback: (event: string, user: User | null) => void
  ) {
    return supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        const user = session?.user || null;

        if (user && event === 'SIGNED_IN') {
          const dbUser = await DatabaseService.getUser(user.id);
          if (!dbUser) {
            await DatabaseService.createUser(user.id, user.email!, user.user_metadata.name);
            const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
            await DatabaseService.createOrUpdateTokenUsage(user.id, currentMonth, 0, 500);
            await DatabaseService.createOrUpdateUploadQuota(user.id, currentMonth, 0, 1);
          }
        }

        callback(event, user);
      })();
    });
  }
}
