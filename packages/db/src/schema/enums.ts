import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['user', 'moderator', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);

export const authPurpose = pgEnum('auth_purpose', ['signin', 'signup']);

export const linkStatus = pgEnum('link_status', [
  'active',
  'disabled_by_user',
  'disabled_by_admin',
  'disabled_by_safety',
  'pending_review',
]);

export const safetyState = pgEnum('safety_state', [
  'unchecked',
  'clean',
  'suspicious',
  'malicious',
]);

export const reportReason = pgEnum('report_reason', [
  'phishing',
  'malware',
  'spam',
  'nsfw',
  'illegal',
  'other',
]);

export const brandTermPolicy = pgEnum('brand_term_policy', ['flag', 'reject']);
