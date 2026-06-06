import { ToastProvider } from '@clipal/ui';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { AppSidebar } from '@/components/app-sidebar';
import { requireUser } from '@/lib/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === 'admin' || user.role === 'moderator';

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <AppHeader user={user} />
        <div className="mx-auto flex w-full max-w-6xl flex-1">
          <AppSidebar isAdmin={isAdmin} />
          <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
