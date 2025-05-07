import clsx from 'clsx';
import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary';
  size?: 'sm' | 'md' | 'lg';
  startContent?: React.ReactNode;
  endContent?: React.ReactNode;
  isLoading?: boolean;
  hoverContent?: React.ReactNode;
  showHoverContent?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant = 'primary',
  size = 'md',
  startContent,
  endContent,
  isLoading,
  children,
  disabled,
  hoverContent,
  showHoverContent = false,
  ...props
}, ref) => {
  return (
    <button
      ref={ref}
      disabled={isLoading || disabled}
      className={clsx(
        "inline-flex items-center justify-center rounded-full font-medium transition-all",
        "focus-visible:outline-none transform hover:scale-[1.02] hover:shadow-md",
        "disabled:pointer-events-none disabled:opacity-50",
        {
          'primary': "text-sm px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-400",
          'secondary': "bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100",
          'tertiary': "bg-transparent hover:bg-gray-100 text-gray-700 dark:hover:bg-gray-800 dark:text-gray-300",
        }[variant],
        {
          'sm': "min-h-[2rem] px-3 text-sm py-1",
          'md': "min-h-[2.5rem] px-4 py-1",
          'lg': "min-h-[3rem] px-4 py-2 text-sm",
        }[size],
        "group",
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
      {startContent && (
        <span className={clsx(
          "shrink-0",
          children || hoverContent ? "mr-2" : ""
        )}>
          {startContent}
        </span>
      )}
      <span className="truncate">
        {showHoverContent ? (
          <>
            <span className="group-hover:hidden">{children}</span>
            <span className="hidden group-hover:inline">{hoverContent}</span>
          </>
        ) : children}
      </span>
      {endContent && <span className="ml-2 shrink-0">{endContent}</span>}
    </button>
  );
});

Button.displayName = "Button"; 