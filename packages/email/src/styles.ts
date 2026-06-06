import type { CSSProperties } from 'react';

/** Shared monochrome email styles (§19 — very plain, mono code). */
export const styles = {
  main: {
    backgroundColor: '#ffffff',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  } satisfies CSSProperties,
  container: {
    maxWidth: '480px',
    margin: '0 auto',
    padding: '32px 24px',
  } satisfies CSSProperties,
  brand: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '14px',
    color: '#71717a',
    letterSpacing: '-0.01em',
    margin: '0 0 24px',
  } satisfies CSSProperties,
  heading: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#09090b',
    margin: '0 0 8px',
    letterSpacing: '-0.01em',
  } satisfies CSSProperties,
  para: {
    fontSize: '14px',
    lineHeight: '1.6',
    color: '#3f3f46',
    margin: '0 0 16px',
  } satisfies CSSProperties,
  meta: {
    fontSize: '13px',
    lineHeight: '1.5',
    color: '#71717a',
    margin: '0 0 16px',
  } satisfies CSSProperties,
  codeBox: {
    border: '1px solid #e4e4e7',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center',
    margin: '0 0 16px',
  } satisfies CSSProperties,
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '32px',
    fontWeight: 600,
    letterSpacing: '0.3em',
    color: '#09090b',
    margin: 0,
  } satisfies CSSProperties,
  hr: {
    borderColor: '#e4e4e7',
    margin: '24px 0',
  } satisfies CSSProperties,
  footer: {
    fontSize: '12px',
    lineHeight: '1.5',
    color: '#a1a1aa',
    margin: 0,
  } satisfies CSSProperties,
} as const;
