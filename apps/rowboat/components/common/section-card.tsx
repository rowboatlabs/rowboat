import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface SectionCardProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  labelWidth?: string; // e.g., 'md:w-32'
  className?: string;
  style?: React.CSSProperties;
  chevronSize?: string;
  /**
   * If true, all fields are single column. If string[], only those fields are single column (by label).
   * If not provided, all fields use the default two-column layout.
   */
  singleColumnFields?: string[] | boolean;
}

export function SectionCard({ icon, title, children, labelWidth = 'md:w-32', className = '', style, chevronSize = 'w-4 h-4' }: SectionCardProps) {
  const [expanded, setExpanded] = useState(true);

  React.useEffect(() => {
    const btn = document.getElementById(`section-card-header-${title && typeof title === 'string' ? title : ''}`);
    if (btn) {
      const chevron = btn.querySelector('svg');
      if (chevron) {
        // Chevron positioning logic can go here if needed
      }
      const iconEl = btn.querySelector('.section-card-icon');
      if (iconEl) {
        // Icon positioning logic can go here if needed
      }
      const label = btn.querySelector('span');
      if (label) {
        // Label positioning logic can go here if needed
      }
    }
  }, [title]);

  return (
    <div className={`rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-gray-900 ${className}`}
      style={style}
    >
      <button
        id={`section-card-header-${title && typeof title === 'string' ? title : ''}`}
        type="button"
        className={`flex items-center gap-2 ${labelWidth} ${expanded ? 'mb-6' : 'mb-1'} focus:outline-none select-none`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`flex-none shrink-0`}>
          {expanded ? <ChevronDown className={`${chevronSize} text-gray-400`} /> : <ChevronRight className={`${chevronSize} text-gray-400`} />}
        </span>
        {icon && (
          <div className="section-card-icon flex items-center justify-center w-6 h-6 flex-none shrink-0">
            {icon}
          </div>
        )}
        <span className="text-base font-semibold flex-1 text-left">{title}</span>
      </button>
      <div
        style={{
          maxHeight: expanded ? 9999 : 0,
          overflow: "hidden",
          transition: "max-height 0.2s cubic-bezier(0.4,0,0.2,1)"
        }}
      >
        {expanded && children}
      </div>
    </div>
  );
}
