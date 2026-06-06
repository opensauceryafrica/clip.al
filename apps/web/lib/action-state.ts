/**
 * Return shapes for form server actions. Kept out of the `'use server'` files
 * because those may only export async functions.
 */

export interface ShortenState {
  ok: boolean;
  shortUrl?: string;
  code?: string;
  flagged?: boolean;
  anonymous?: boolean;
  error?: string;
}

export interface AuthState {
  error?: string;
}

export interface ReportState {
  ok: boolean;
  error?: string;
}

export interface FormActionState {
  error?: string;
  ok?: boolean;
}
