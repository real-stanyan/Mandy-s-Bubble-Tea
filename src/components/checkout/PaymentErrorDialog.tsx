"use client";

import Image from "next/image";
import { BRAND } from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function PaymentErrorDialog({
  open,
  message,
  onCancel,
  onRetry,
  title = "Payment Failed",
}: {
  open: boolean;
  message: string | null;
  onCancel: () => void;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <div className="flex justify-center">
          <Image
            src="/payment-error.webp"
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
            {message ?? "Something went wrong with your payment."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onRetry}
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Retry
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
