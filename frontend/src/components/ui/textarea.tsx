import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-xl border border-border/60 bg-white px-3.5 py-2 text-base transition-all duration-200 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-4 focus-visible:ring-primary/10 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
