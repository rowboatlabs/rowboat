import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/contexts/theme-context"

const Toaster = ({ ...props }: ToasterProps) => {
  // Without this, sonner defaults to its light theme: our inline vars keep
  // the background/title correct in dark mode, but the description falls
  // back to sonner's hardcoded light-theme gray — dark text on dark bg.
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Sonner styles toast parts with attribute selectors that outrank plain
      // utility classes, hence the trailing-! (important) utilities.
      toastOptions={{
        classNames: {
          toast:
            "bg-popover/90! backdrop-blur-xl! text-popover-foreground! border-border/60! rounded-xl! shadow-xl! shadow-black/10! gap-3! p-4!",
          description: "text-muted-foreground! leading-relaxed! mt-0.5!",
          actionButton:
            "bg-primary! text-primary-foreground! rounded-md! font-medium! px-3! transition-colors! hover:bg-primary/85!",
          cancelButton:
            "bg-transparent! text-muted-foreground! border! border-solid! border-border! rounded-md! transition-colors! hover:bg-muted! hover:text-foreground!",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
