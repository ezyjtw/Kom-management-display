/**
 * Automatic refreshes (polls) mark themselves with this header so the server
 * does not count them as user activity: a tab left open must still reach the
 * 1-hour idle sign-out (load review, Phase 12n; spec §17.3). Shared by the
 * browser helper (src/lib/client/background-fetch.ts) and requireAuth.
 */
export const BACKGROUND_REQUEST_HEADER = "x-kom-background";
