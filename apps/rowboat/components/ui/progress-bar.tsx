import React from 'react';
import { cn } from "../../lib/utils";

export interface ProgressStep {
  id: number;
  label: string;
  completed: boolean;
}

interface ProgressBarProps {
  steps: ProgressStep[];
  className?: string;
}

export function ProgressBar({ steps, className }: ProgressBarProps) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      {/* Progress Label */}
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">
        Progress:
      </span>
      
      {/* Steps */}
      <div className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          
          return (
            <div key={step.id} className="flex items-center">
              {/* Step Circle with Tooltip */}
              <div
                className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-all duration-300 cursor-default",
                  step.completed
                    ? "bg-green-500 border-green-500 text-white"
                    : "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400"
                )}
                title={step.label}
              >
                {step.id}
              </div>
              
              {/* Connecting Line */}
              {!isLast && (
                <div
                  className={cn(
                    "h-0.5 w-8 mx-2 transition-all duration-300",
                    step.completed
                      ? "bg-green-500"
                      : "border-t-2 border-dashed border-gray-300 dark:border-gray-600"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}