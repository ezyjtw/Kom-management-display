/** Absolute session lifetime (spec §6.2). Shared by NextAuth and the Edge middleware. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Session cookie (spec §17.4): httpOnly, SameSite=Lax, host-scoped. On HTTPS
 * the __Host- prefix makes the browser enforce Secure, Path=/ and no Domain.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-kom.session-token" : "kom.session-token";
}

/** Idle timeout (spec §17.4): a session with no authenticated request for this long is revoked. */
export const SESSION_IDLE_SECONDS = 60 * 60;
