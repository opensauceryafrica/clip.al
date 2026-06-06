import { env } from '@clipal/config';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SigninForm } from '@/components/signin-form';
import { getSessionUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SigninPage() {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');
  return <SigninForm siteKey={env.TURNSTILE_SITE_KEY} />;
}
