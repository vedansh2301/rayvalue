/** Phone-verification limits, shared by the server (src/lib/server/verify.ts) and the OTP step. */
export const MAX_SENDS = 3;
export const MAX_CHECKS = 6;
/** Seconds before another code may be sent. */
export const RESEND_AFTER_SECONDS = 30;
