'use client';

import { forwardRef, TextareaHTMLAttributes } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Send, MoreVertical } from 'lucide-react';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react';
import clsx from 'clsx';

interface TextareaWithSendProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  onImportJson?: () => void;
  importDisabled?: boolean;
  isImporting?: boolean;
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
    onImportJson,
    importDisabled = false,
    isImporting = false,
    placeholder,
    className,
    rows = 3,
    autoFocus = false,
    autoResize = false,
    ...props 
  }, ref) => {
    const hasMore = Boolean(onImportJson);
    return (
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={clsx(
            // Extra right padding for kebab + send controls
            hasMore ? "pr-24" : "pr-14",
            className
          )}
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
        <div className="absolute right-3 bottom-3 flex items-center gap-2">
          {hasMore && (
            <Dropdown>
              <DropdownTrigger>
                <button
                  className={clsx(
                    "rounded-full p-2 transition-all duration-200",
                    "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:scale-105 active:scale-95 hover:bg-gray-200 dark:hover:bg-gray-700"
                  )}
                  aria-label="More actions"
                  title="More actions"
                >
                  <MoreVertical size={18} />
                </button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label="More actions"
                onAction={(key) => {
                  if (key === 'import-json' && onImportJson) {
                    onImportJson();
                  }
                }}
              >
                <DropdownItem key="import-json" isDisabled={importDisabled || isImporting}>
                  {isImporting ? 'Importing Assistant (JSON)…' : 'Import Assistant (JSON)'}
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          )}
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
            aria-label="Send"
            title="Send"
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
