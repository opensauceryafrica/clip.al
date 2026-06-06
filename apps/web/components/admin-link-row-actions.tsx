import { Button } from '@clipal/ui';
import Link from 'next/link';
import { adminDisableLinkAction, adminSetSafetyAction } from '@/app/(admin)/actions';

/** Compact inline actions for an admin links-table row. Server-action forms. */
export function AdminLinkRowActions({ linkId, status }: { linkId: string; status: string }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/links/${linkId}`}>View</Link>
      </Button>
      {status === 'active' ? (
        <form action={adminDisableLinkAction}>
          <input type="hidden" name="linkId" value={linkId} />
          <Button type="submit" variant="ghost" size="sm">
            Disable
          </Button>
        </form>
      ) : null}
      <form action={adminSetSafetyAction}>
        <input type="hidden" name="linkId" value={linkId} />
        <input type="hidden" name="state" value="malicious" />
        <Button type="submit" variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
          Malicious
        </Button>
      </form>
    </div>
  );
}
