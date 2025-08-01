'use client';

import { forwardRef, TextareaHTMLAttributes } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';
import clsx from 'clsx';

interface TextareaWithSendProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  autoResize?: boolean;
}

export const TextareaWithSend = forwardRef<HTMLTextAreaElement, TextareaWithSendProps>(
  ({ 
    value, 
    onChange, 
    onSubmit, 
    isSubmitting = false, 
    submitDisabled = false,
    placeholder,
    className,
    rows = 3,
    autoFocus = false,
    autoResize = false,
    ...props 
  }, ref) => {
    return (
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={clsx("pr-14", className)}
          rows={rows}
          autoFocus={autoFocus}
          autoResize={autoResize}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          {...props}
        />
        <div className="absolute right-3 bottom-3">
          <button
            onClick={onSubmit}
            disabled={isSubmitting || submitDisabled || !value.trim()}
            className={clsx(
              "rounded-full p-2 transition-all duration-200",
              value.trim()
                ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:hover:bg-indigo-800/60 dark:text-indigo-300"
                : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
              isSubmitting ? "opacity-50" : "hover:scale-105 active:scale-95"
            )}
          >
            {isSubmitting ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    );
  }
);

TextareaWithSend.displayName = 'TextareaWithSend';