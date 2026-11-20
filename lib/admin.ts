// Who may create and edit the maps. A constant on purpose (ticket #287): changing it is a deploy.
export const SUPER_ADMIN_EMAIL = 'aelythe@gmail.com';

/** Only a Google sign-in whose email Google has verified counts; guests (name only) never do. */
export function isSuperAdmin(u: { provider?: string | null; email?: string | null; emailVerified?: boolean | null }) {
  return u.provider === 'google' && u.emailVerified === true && (u.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}
