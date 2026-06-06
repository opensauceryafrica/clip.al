'use client';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@clipal/ui';
import { deleteAccountAction } from '@/app/(app)/settings/actions';

export function DeleteAccountDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            Your account is deactivated immediately and scheduled for permanent deletion in 30 days.
            Your links stop redirecting. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <form action={deleteAccountAction}>
            <Button type="submit" variant="destructive">
              Delete my account
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
