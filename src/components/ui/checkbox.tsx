"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Checkbox({
  className,
  checked,
  indeterminate,
  onCheckedChange,
  ...props
}: CheckboxPrimitive.Root.Props): React.ReactElement {
  const isControlledActive = Boolean(checked || indeterminate);
  const prevControlledActiveRef = React.useRef(isControlledActive);
  const shouldAnimateRef = React.useRef(false);

  if (checked !== undefined || indeterminate !== undefined) {
    if (!prevControlledActiveRef.current && isControlledActive) {
      shouldAnimateRef.current = true;
    } else if (!isControlledActive) {
      shouldAnimateRef.current = false;
    }
    prevControlledActiveRef.current = isControlledActive;
  }

  const handleCheckedChange: CheckboxPrimitive.Root.Props["onCheckedChange"] = (
    nextChecked,
    eventDetails,
  ) => {
    shouldAnimateRef.current = Boolean(nextChecked);
    onCheckedChange?.(nextChecked, eventDetails);
  };

  return (
    <CheckboxPrimitive.Root
      checked={checked}
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center rounded-[.25rem] border border-input bg-background not-dark:bg-clip-padding shadow-xs/5 outline-none ring-ring transition-[background-color,border-color,box-shadow,transform] duration-[120ms] ease-[var(--dt-ease)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[3px] not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:inset-1/2 pointer-coarse:after:-translate-1/2 pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:not-data-disabled:not-data-checked:border-ring/70 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-safe:active:not-data-disabled:scale-[0.92] motion-safe:active:not-data-disabled:duration-[80ms] aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/48 data-disabled:cursor-not-allowed data-disabled:opacity-64 dark:not-data-checked:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [[data-disabled],[data-checked],[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="checkbox"
      indeterminate={indeterminate}
      onCheckedChange={handleCheckedChange}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="absolute -inset-px flex items-center justify-center rounded-[.25rem] text-primary-foreground transition-[background-color,opacity] duration-[120ms] ease-[var(--dt-ease)] data-unchecked:hidden data-checked:bg-primary data-indeterminate:text-foreground"
        data-slot="checkbox-indicator"
        render={(
          indicatorProps: React.ComponentProps<"span">,
          state: CheckboxPrimitive.Indicator.State,
        ) => {
          const animateClass = shouldAnimateRef.current ? "dt-check-pop" : undefined;
          return (
            <span {...indicatorProps}>
              {state.indeterminate ? (
                <svg
                  aria-hidden="true"
                  className={cn("size-3", animateClass)}
                  fill="none"
                  height="24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  viewBox="0 0 24 24"
                  width="24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M5.252 12h13.496" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  className={cn("size-3", animateClass)}
                  fill="none"
                  height="24"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  viewBox="0 0 24 24"
                  width="24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
                </svg>
              )}
            </span>
          );
        }}
      />
    </CheckboxPrimitive.Root>
  );
}

export { CheckboxPrimitive };
