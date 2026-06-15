'use client';

import {
  Button,
  CodeBlock,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@clipal/ui';
import { Plus, RotateCw, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { API_SCOPES, API_SCOPE_META, type ApiScope } from '@/lib/api-auth';
import {
  createApiKeyAction,
  rotateApiKeyAction,
  type CreateKeyState,
} from './actions';

const initial: CreateKeyState = {};

/** Scope checkbox grid, reused by create + rotate flows. */
function ScopeCheckboxes({ selected }: { selected?: readonly ApiScope[] }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-foreground">Scopes</legend>
      <div className="grid grid-cols-1 gap-1.5">
        {API_SCOPES.map((scope) => (
          <label
            key={scope}
            className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent has-[:checked]:border-foreground/30"
          >
            <input
              type="checkbox"
              name="scopes"
              value={scope}
              defaultChecked={selected ? selected.includes(scope) : true}
              className="mt-0.5 size-4 cursor-pointer accent-foreground"
            />
            <span className="min-w-0">
              <span className="block font-mono text-[13px] text-foreground">{scope}</span>
              <span className="block text-xs text-muted-foreground">
                {API_SCOPE_META[scope].description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * One-time key reveal shown after a successful create/rotate. The plaintext is
 * never returned again — the panel insists the user copy it now.
 */
function KeyReveal({
  plaintext,
  name,
  onDone,
}: {
  plaintext: string;
  name?: string | undefined;
  onDone: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Copy your API key</DialogTitle>
        <DialogDescription>
          {name ? <>Key <span className="font-medium text-foreground">{name}</span> is ready. </> : null}
          Copy it now — for your security it won&apos;t be shown again.
        </DialogDescription>
      </DialogHeader>
      <CodeBlock value={plaintext} />
      <p className="text-xs text-muted-foreground">
        Send it as <code className="font-mono">Authorization: Bearer {plaintext.slice(0, 13)}…</code>
      </p>
      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone}>
          I&apos;ve saved it
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Create dialog. On success the action returns the plaintext key, surfaced ONCE
 * in a copy-once panel; the dialog flips into that confirmation step rather than
 * closing immediately.
 */
export function CreateKeyDialog({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createApiKeyAction, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Plus className="size-4" />
          New API key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.plaintext ? (
          <KeyReveal plaintext={state.plaintext} name={state.name} onDone={() => setOpen(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Authenticate requests to the clip.al API with this key.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="off"
                  defaultValue={state.name ?? ''}
                  placeholder="e.g. CI deploy bot"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key-env">Environment</Label>
                <select
                  id="key-env"
                  name="env"
                  defaultValue="live"
                  className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="live">Live (clpl_live_…)</option>
                  <option value="test">Test (clpl_test_…)</option>
                </select>
              </div>
              <ScopeCheckboxes />
              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary" size="sm">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Creating…' : 'Create key'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Destructive-confirm revoke dialog. The owning page passes a bound server
 * action so this same component serves both the user and admin pages. The form
 * submits `keyId`; the action is responsible for ownership + audit.
 */
export function RevokeKeyDialog({
  keyId,
  name,
  action,
}: {
  keyId: string;
  name: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke “{name}”?</DialogTitle>
          <DialogDescription>
            This immediately and permanently disables the key. Any integration using it will start
            receiving <code className="font-mono">401 unauthorized</code>. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <form action={action}>
          <input type="hidden" name="keyId" value={keyId} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button type="submit" variant="destructive" size="sm">
                Revoke key
              </Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rotate dialog. Revokes the existing key and mints a replacement with the same
 * name + scopes; the new plaintext is shown ONCE.
 */
export function RotateKeyDialog({ keyId, name }: { keyId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(rotateApiKeyAction, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <RotateCw className="size-3.5" />
          Rotate
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.plaintext ? (
          <KeyReveal plaintext={state.plaintext} name={state.name} onDone={() => setOpen(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Rotate “{name}”</DialogTitle>
              <DialogDescription>
                The current key is revoked immediately and a new one is issued with the same name
                and scopes. Update your integrations before closing.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="keyId" value={keyId} />
              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary" size="sm">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Rotating…' : 'Rotate key'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
