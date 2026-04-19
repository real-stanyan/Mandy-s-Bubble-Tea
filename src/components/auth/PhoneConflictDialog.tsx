"use client";

import Image from "next/image";
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

// Modal shown when the visitor tries to link a phone number that
// already belongs to another account (different OAuth provider or a
// prior phone-only signup). Matches the PaymentErrorDialog visual
// language so the error surface feels consistent across the app.
export function PhoneConflictDialog({
  open,
  onClose,
  title = "Phone number in use",
  message,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <div className="flex justify-center">
          <Image
            src="/phone-conflict.webp"
            alt=""
            width={160}
            height={160}
            className="h-40 w-40 object-contain"
            priority
          />
        </div>
        <AlertDialogHeader className="text-center sm:text-center">
          <AlertDialogTitle className="text-center">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {message ??
              "This phone number is already linked to another account. Please sign in with the method you used last time (Apple, Google, or Phone), or use a different number."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction
            onClick={onClose}
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Got it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
