import { cn } from "@heroui/react";
import { ButtonHTMLAttributes, forwardRef } from "react";
import { LucideIcon } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant = 'default',
  size = 'md',
  startContent,
  endContent,
  isLoading,
  children,
  disabled,
  ...props
}, ref) => {
  return (
    <button
      ref={ref}
      disabled={isLoading || disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
        "disabled:pointer-events-none disabled:opacity-50",
        {
          'default': "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200",
          'outline': "border border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800",
          'ghost': "hover:bg-gray-100 dark:hover:bg-gray-800",
        }[variant],
        {
          'sm': "h-8 px-3 text-sm",
          'md': "h-10 px-4",
          'lg': "h-12 px-6 text-lg",
        }[size],
        className
      )}
      {...props}
    >
      {isLoading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {startContent && <span className="mr-2">{startContent}</span>}
      {children}
      {endContent && <span className="ml-2">{endContent}</span>}
    </button>
  );
});

Button.displayName = "Button"; 