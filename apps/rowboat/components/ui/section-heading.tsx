import { cn } from "@heroui/react";
import { tokens } from "@/app/styles/tokens";

interface SectionHeadingProps {
  children: React.ReactNode;
  subheading?: React.ReactNode;
}

export function SectionHeading({ children, subheading }: SectionHeadingProps) {
  return (
    <div className="space-y-0.5 mb-4">
      <div className={cn(
        "text-lg text-left",
        tokens.colors.text.primary.light,
        tokens.colors.text.primary.dark
      )}>
        {children}
      </div>
      {subheading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {subheading}
        </p>
      )}
    </div>
  );
} 