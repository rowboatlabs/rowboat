"use client"

import * as React from "react"
import { useState } from "react"
import { MessageCircle } from "lucide-react"

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

  const handleDiscordClick = () => {
    window.open("https://discord.gg/htdKpBZF", "_blank")
  }

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
            Get help from our community
          </p>
        </div>
        <div className="p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 h-auto py-3"
            onClick={handleDiscordClick}
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-[#5865F2]">
              <MessageCircle className="size-4 text-white" />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">Join our Discord</span>
              <span className="text-xs text-muted-foreground">
                Chat with the community
              </span>
            </div>
          </Button>
        </div>
        <div className="px-4 py-3 border-t flex justify-center gap-3 text-xs text-muted-foreground">
          <a
            href="https://www.rowboatlabs.com/terms-of-service"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Terms of Service
          </a>
          <span>·</span>
          <a
            href="https://www.rowboatlabs.com/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Privacy Policy
          </a>
        </div>
      </PopoverContent>
    </Popover>
  )
}
