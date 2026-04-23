"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/components/auth/AuthProvider";

export function DeleteAccountBtn() {
  const router = useRouter();
  const { deleteAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      await deleteAccount();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <div className="px-4 mt-3 mb-6 flex flex-col items-center gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="text-red-600 underline transition active:opacity-70"
            style={{ fontSize: 12 }}
          >
            Delete account
          </button>
        </AlertDialogTrigger>
        <AlertDialogPortal>
          <AlertDialogOverlay className="mbt-dialog-overlay fixed inset-0 z-50 bg-black/55" />
          <AlertDialogContent className="mbt-dialog-content fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-white p-5 shadow-primary-cta">
            <AlertDialogHeader>
              <AlertDialogTitle
                className="font-serif text-ink"
                style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
              >
                Delete account?
              </AlertDialogTitle>
              <AlertDialogDescription
                className="mt-2 text-ink2"
                style={{ fontSize: 13, lineHeight: "18px" }}
              >
                This will permanently remove your account, loyalty stars, and
                order history. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p
                className="mt-2 text-red-600"
                style={{ fontSize: 12 }}
              >
                {error}
              </p>
            )}
            <AlertDialogFooter className="mt-4 flex justify-end gap-2">
              <AlertDialogCancel
                className="rounded-full border border-line bg-paper px-4 py-2 text-ink transition active:bg-cream"
                style={{ fontSize: 13, fontWeight: 500 }}
                disabled={pending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="rounded-full bg-red-600 px-4 py-2 text-white transition active:opacity-85 disabled:opacity-60"
                style={{ fontSize: 13, fontWeight: 600 }}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
  );
}
