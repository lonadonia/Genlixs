"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Modal built on the native <dialog> element: focus is contained by the
 * browser, Escape closes it, and focus returns to the invoking control.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  surface = "dark",
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  surface?: "dark" | "light";
  size?: "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handleClose = () => {
      onClose();
      returnFocus.current?.focus?.();
    };
    d.addEventListener("close", handleClose);
    return () => d.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-dialog)] border p-0 shadow-[var(--shadow-pop)] backdrop:bg-[rgb(8_10_10/0.75)] backdrop:backdrop-blur-[3px]",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-2xl",
        size === "xl" && "max-w-5xl",
        surface === "dark" ? "border-line bg-surface text-ink" : "surface-light border-rule bg-sheet text-ink-dark",
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className={cn("flex items-start gap-4 border-b px-5 py-4 sm:px-6", surface === "dark" ? "border-line" : "border-rule")}>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description ? (
                <div id={descId} className={cn("mt-1 text-sm", surface === "dark" ? "text-muted" : "text-muted-dark")}>
                  {description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={cn(
                "-mr-2 grid size-10 shrink-0 place-items-center rounded-full",
                surface === "dark" ? "text-muted hover:bg-raised hover:text-ink" : "text-muted-dark hover:bg-neutral-tint",
              )}
            >
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close</span>
            </button>
          </header>
          <div className="scroll-thin overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer ? (
            <footer
              className={cn(
                "flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-6",
                surface === "dark" ? "border-line" : "border-rule",
              )}
            >
              {footer}
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
