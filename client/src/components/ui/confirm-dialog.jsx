import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { initialConfirmState, registerConfirmSetState, settleConfirm } from "@/lib/confirm-store";

export function ConfirmDialogProvider() {
  const [state, setState] = useState(initialConfirmState);

  useEffect(() => {
    registerConfirmSetState(setState);
    return () => registerConfirmSetState(null);
  }, []);

  const settle = (value) => {
    settleConfirm(value);
    setState((s) => ({ ...s, open: false }));
  };

  return (
    <AlertDialog open={state.open} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          {state.description && (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{state.cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={state.variant === "destructive" ? buttonVariants({ variant: "destructive" }) : undefined}
            onClick={() => settle(true)}
          >
            {state.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
