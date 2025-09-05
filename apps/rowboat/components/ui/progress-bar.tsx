"use client";
import React from 'react';
import { cn } from "../../lib/utils";
import { Tooltip } from "@heroui/react";

export interface ProgressStep {
  id: number;
  label: string;
  completed: boolean;
  icon?: string; // The icon/symbol to show instead of number
  isCurrent?: boolean; // Whether this is the current step
  shortLabel?: string; // Optional short label to show inline on larger screens
}

interface ProgressBarProps {
  steps: ProgressStep[];
  className?: string;
  onStepClick?: (step: ProgressStep, index: number) => void;
}

export function ProgressBar({ steps, className, onStepClick }: ProgressBarProps) {
  const getShortLabel = (label: string) => {
    if (!label) return "";
    const beforeColon = label.split(":")[0]?.trim();
    if (beforeColon) return beforeColon;
    const firstWord = label.split(" ")[0]?.trim();
    return firstWord || label;
  };

  return (
    <nav aria-label="Workflow progress" className={cn("flex items-center gap-4", className)}>
      {/* Progress Label */}
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">
        Progress:
      </span>

      {/* Steps */}
      <ol role="list" className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;

          return (
            <li key={step.id} className="flex items-center">
              {/* Step Circle with Tooltip */}
              <div className="flex flex-col items-center">
                <Tooltip
                  content={step.label}
                  size="lg"
                  delay={100}
                  placement="bottom"
                  classNames={{ content: "text-base" }}
                >
                  <div
                    tabIndex={0}
                    aria-label={`${step.completed ? "Completed" : step.isCurrent ? "Current" : "Pending"} step ${step.id}: ${step.label}`}
                    aria-current={step.isCurrent ? "step" : undefined}
                    role={onStepClick ? 'button' as const : undefined}
                    onClick={onStepClick ? () => onStepClick(step, index) : undefined}
                    onKeyDown={onStepClick ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onStepClick(step, index);
                      }
                    } : undefined}
                    className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-400",
                      step.completed
                        ? "bg-green-500 border-green-500 text-white"
                        : step.isCurrent
                          ? "bg-yellow-500 border-yellow-500 text-white ring-2 ring-yellow-300/60 shadow-sm"
                          : "bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400"
                    , onStepClick ? "cursor-pointer hover:scale-105" : "cursor-default")}
                  >
                    {step.completed ? "✓" : step.isCurrent ? "⚡" : "○"}
                  </div>
                </Tooltip>
                <span className="hidden md:block mt-1 text-[11px] leading-none text-gray-700 dark:text-gray-300 font-medium">
                  {step.shortLabel ?? getShortLabel(step.label)}
                </span>
              </div>

              {/* Connecting Line */}
              {!isLast && (
                <div
                  aria-hidden
                  className={cn(
                    "h-0.5 w-8 mx-2 transition-all duration-300 motion-reduce:transition-none",
                    step.completed
                      ? "bg-green-500"
                      : "border-t-2 border-dashed border-gray-300 dark:border-gray-600"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
