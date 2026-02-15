import { cn } from "@/lib/utils"
import { AlertTriangleIcon, InfoIcon, Loader2Icon, TrashIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ReactNode } from "react"

type ConfirmVariant = "default" | "destructive" | "info"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
  loading?: boolean
  children?: ReactNode
}

const variantConfig: Record<ConfirmVariant, {
  icon: ReactNode
  iconClass: string
  confirmVariant: "default" | "destructive"
}> = {
  default:     { icon: <AlertTriangleIcon className="size-5" />, iconClass: "bg-amber-500/10 text-amber-500",  confirmVariant: "default" },
  destructive: { icon: <TrashIcon className="size-5" />,         iconClass: "bg-destructive/10 text-destructive", confirmVariant: "destructive" },
  info:        { icon: <InfoIcon className="size-5" />,          iconClass: "bg-primary/10 text-primary",      confirmVariant: "default" },
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
  loading = false,
  children,
}: ConfirmDialogProps) {
  const v = variantConfig[variant]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="flex-row items-start gap-4 text-left">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", v.iconClass)}>
            {v.icon}
          </div>
          <div className="space-y-1.5">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
        </DialogHeader>

        {children && <div className="py-2">{children}</div>}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => { onCancel?.(); onOpenChange(false) }} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={v.confirmVariant}
            onClick={async () => { await onConfirm(); onOpenChange(false) }}
            disabled={loading}
          >
            {loading ? <><Loader2Icon className="size-4 animate-spin" /> Processing...</> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
