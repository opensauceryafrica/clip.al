import { ToastProvider } from '@clipal/ui';
import type { ReactNode } from 'react';
import { AdminSidebar } from '@/components/admin-sidebar';
import { AppHeader } from '@/components/app-header';
import { requireAdmin } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <AppHeader user={admin} />
        <div className="mx-auto flex w-full max-w-6xl flex-1">
          <AdminSidebar />
          <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
