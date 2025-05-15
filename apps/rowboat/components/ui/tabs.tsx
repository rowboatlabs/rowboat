import * as React from "react"
import { Tabs as HeroTabs, Tab as HeroTab } from "@heroui/react"
import { cn } from "../../lib/utils"

const Tabs = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof HeroTabs>>(
  ({ className, ...props }, ref) => (
    <HeroTabs
      ref={ref}
      className={cn("w-full", className)}
      {...props}
    />
  )
);

Tabs.displayName = "Tabs";

export { Tabs, HeroTab as Tab } 