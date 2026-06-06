import { env } from '@clipal/config';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { VerifyForm } from '@/components/verify-form';

export const metadata: Metadata = { title: 'Verify' };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  if (!email) redirect('/signin');
  return <VerifyForm email={email} siteKey={env.TURNSTILE_SITE_KEY} />;
}
