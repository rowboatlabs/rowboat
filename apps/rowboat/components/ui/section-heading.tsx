import { cn } from "@heroui/react";
import { tokens } from "@/app/styles/tokens";

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(
      "text-lg mb-4 text-left",
      tokens.colors.text.primary.light,
      tokens.colors.text.primary.dark
    )}>
      {children}
    </div>
  );
} 