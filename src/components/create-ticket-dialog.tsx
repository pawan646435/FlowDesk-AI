"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTicketAction } from "@/app/tickets/actions";
import { Plus, X, Loader2 } from "lucide-react";

export function CreateTicketDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, isPending] = useActionState(createTicketAction, null);

  const openModal = () => {
    dialogRef.current?.showModal();
  };

  const closeModal = () => {
    dialogRef.current?.close();
  };

  useEffect(() => {
    if (state?.success) {
      closeModal();
      const form = dialogRef.current?.querySelector("form");
      if (form) form.reset();
    }
  }, [state]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      closeModal();
    }
  };

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-all shadow-md glow-purple cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        New Ticket
      </button>

      <dialog
        ref={dialogRef}
        onClick={handleBackdropClick}
        className="fixed inset-0 m-auto h-fit rounded-2xl border border-border/40 p-0 w-full max-w-lg bg-background text-foreground shadow-2xl glass backdrop:bg-background/80 backdrop:backdrop-blur-sm focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
          <h3 className="text-xl font-semibold">Create Support Ticket</h3>
          <button
            onClick={closeModal}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form action={formAction} className="p-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-semibold text-foreground">
              Ticket Title
            </label>
            <input
              type="text"
              id="title"
              name="title"
              required
              placeholder="Brief summary of the issue..."
              className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all"
            />
            {state?.fieldErrors?.title && (
              <p className="text-xs font-medium text-destructive mt-1">
                {state.fieldErrors.title[0]}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-semibold text-foreground">
              Description / Details
            </label>
            <textarea
              id="description"
              name="description"
              required
              rows={4}
              placeholder="Provide more context about what went wrong..."
              className="w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-all resize-none"
            />
            {state?.fieldErrors?.description && (
              <p className="text-xs font-medium text-destructive mt-1">
                {state.fieldErrors.description[0]}
              </p>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/30 p-4 transition-all hover:bg-background/50">
            <input
              type="checkbox"
              id="isHighPriority"
              name="isHighPriority"
              className="mt-0.5 h-4 w-4 rounded border-border/60 bg-background text-primary focus:ring-primary focus:ring-offset-background accent-primary cursor-pointer transition-all"
            />
            <div className="flex flex-col">
              <label htmlFor="isHighPriority" className="text-sm font-semibold text-foreground select-none cursor-pointer">
                High Priority Escalation
              </label>
              <span className="text-xs text-muted-foreground">
                Flags this ticket as urgent and bypasses normal queue to alert support teams.
              </span>
            </div>
          </div>

          {state?.error && !state?.fieldErrors && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive font-medium">
              {state.error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/40">
            <button
              type="button"
              onClick={closeModal}
              disabled={isPending}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-muted transition-colors border border-border/40 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 shadow-md glow-purple cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Ticket"
              )}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
