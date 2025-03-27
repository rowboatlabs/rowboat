import { cn } from "@heroui/react";
import { tokens } from "@/app/styles/design-tokens";

interface SectionHeadingProps {
  children: React.ReactNode;
  subheading?: React.ReactNode;
}

export function SectionHeading({ children, subheading }: SectionHeadingProps) {
  return (
    <div className="space-y-1">
      <div className={cn(
        tokens.typography.weights.medium,
        tokens.typography.sizes.lg,
        tokens.colors.light.text.primary,
        tokens.colors.dark.text.primary
      )}>
        {children}
      </div>
      {subheading && (
        <p className={cn(
          tokens.typography.sizes.sm,
          tokens.typography.weights.normal,
          tokens.colors.light.text.secondary,
          tokens.colors.dark.text.secondary
        )}>
          {subheading}
        </p>
      )}
    </div>
  );
} 