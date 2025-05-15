import * as React from "react"
import { Switch as HeroSwitch } from "@heroui/react"
import { cn } from "@/lib/utils"

interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  className?: string
  disabled?: boolean
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, defaultChecked, onCheckedChange, disabled, className }, ref) => {
    return (
      <HeroSwitch
        ref={ref}
        isSelected={checked}
        defaultSelected={defaultChecked}
        onValueChange={onCheckedChange}
        isDisabled={disabled}
        color="primary"
        className={className}
      />
    );
  }
);

Switch.displayName = "Switch";

export { Switch } 