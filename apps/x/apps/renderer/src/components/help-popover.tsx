"use client"

import * as React from "react"
import { useState } from "react"
import { MessageCircle, BookOpen, GitBranch } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"

interface HelpPopoverProps {
  children: React.ReactNode
  tooltip?: string
}

export function HelpPopover({ children, tooltip }: HelpPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {tooltip ? (
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {children}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
      )}
      <PopoverContent
        side="right"
        align="end"
        sideOffset={4}
        className="w-80 p-0"
      >
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm">Help & Support</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Resources and documentation
          </p>
        </div>
        <div className="p-2 space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-auto py-3"
            onClick={() => window.open("https://github.com/gokulb20/rowboat", "_blank")}
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-foreground/10">
              <GitBranch className="size-4" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">GitHub Repository</span>
              <span className="text-xs text-muted-foreground">
                Source code and issues
              </span>
            </div>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-auto py-3"
            onClick={() => window.open("https://discord.com/invite/wajrgmJQ6b", "_blank")}
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-[#5865F2]">
              <MessageCircle className="size-4 text-white" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">Community Discord</span>
              <span className="text-xs text-muted-foreground">
                Chat with the community
              </span>
            </div>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-auto py-3"
            onClick={() => window.open("https://docs.rowboatlabs.com", "_blank")}
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-emerald-500/10">
              <BookOpen className="size-4 text-emerald-600" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">Documentation</span>
              <span className="text-xs text-muted-foreground">
                Guides and API reference
              </span>
            </div>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
