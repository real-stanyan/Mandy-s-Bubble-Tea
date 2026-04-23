"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STORAGE_KEY = "mbt.pickupReminderDismissed";

export function PickupReminderDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setOpen(false);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-center sm:text-center">
          <AlertDialogTitle className="text-center">
            Pickup Reminder
          </AlertDialogTitle>
        </AlertDialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600">
          <li>
            Pick Up drinks are best collected within 10 minutes of the
            scheduled time.
          </li>
          <li>Please arrive on time to enjoy the best taste and ice level.</li>
          <li>Orders not collected promptly may affect drink quality.</li>
        </ul>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction
            onClick={dismiss}
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Got it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
