'use server';
import { signOut } from '@/auth';
import { withBase } from '@/lib/base-path';

export async function signOutAction() {
  await signOut({ redirectTo: withBase('/') });
}
