import clsx from "clsx";
import { Sparkles } from "lucide-react";
import { SHOW_COPILOT_MARQUEE } from "@/app/lib/feature_flags";
import Image from "next/image";
import mascot from "@/public/mascot.png";

export function ActionButton({
    icon = null,
    children,
    onClick = undefined,
    disabled = false,
    primary = false,
}: {
    icon?: React.ReactNode;
    children: React.ReactNode;
    onClick?: () => void | undefined;
    disabled?: boolean;
    primary?: boolean;
}) {
    const onClickProp = onClick ? { onClick } : {};
    return <button
        disabled={disabled}
        className={clsx("rounded-md text-xs flex items-center gap-1 disabled:text-gray-300 dark:disabled:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300", {
            "text-blue-600 dark:text-blue-400": primary,
            "text-gray-400 dark:text-gray-500": !primary,
        })}
        {...onClickProp}
    >
        {icon}
        {children}
    </button>;
}

interface PanelProps {
    title: React.ReactNode;
    subtitle?: string;
    icon?: React.ReactNode;
    rightActions?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    maxHeight?: string;
    variant?: 'default' | 'copilot' | 'playground' | 'projects' | 'entity-list';
    showWelcome?: boolean;
    className?: string;
    onClick?: () => void;
    tourTarget?: string;
    overflow?: 'hidden' | 'visible' | 'auto' | 'scroll' | undefined;
}

export function Panel({
    title,
    subtitle,
    icon,
    rightActions,
    actions,
    children,
    maxHeight,
    variant = 'default',
    showWelcome = true,
    className,
    onClick,
    tourTarget,
    overflow,
}: PanelProps) {
    const isEntityList = variant === 'entity-list';
    
    return <div 
        className={clsx(
            "flex flex-col rounded-xl border relative w-full",
            // Only apply overflow-hidden if no custom overflow is set (for backward compatibility)
            overflow ? undefined : "overflow-hidden",
            variant === 'copilot' ? "border-transparent" : "border-zinc-200 dark:border-zinc-800",
            variant === 'copilot' ? "bg-zinc-50 dark:bg-zinc-900" : "bg-white dark:bg-zinc-900",
            maxHeight ? "max-h-(--panel-height)" : "h-full",
            className
        )}
        style={{ 
            '--panel-height': maxHeight,
            ...(overflow ? { overflow } : {})
        } as React.CSSProperties}
        onClick={onClick}
        data-tour-target={tourTarget}
    >
        <div 
            className={clsx(
                "shrink-0 border-b relative",
                // Use the same header treatment as entity list/default for playground/copilot
                "border-zinc-100 dark:border-zinc-800",
                {
                    "flex flex-col gap-3 px-4 py-3": variant === 'projects',
                    "flex items-center justify-between h-[53px] p-3": isEntityList,
                    "flex items-center justify-between px-3 py-2": variant === 'copilot' || variant === 'playground',
                    "flex items-center justify-between px-6 py-3": !isEntityList && variant !== 'projects' && variant !== 'copilot' && variant !== 'playground'
                }
            )}
        >
            {variant === 'projects' ? (
                <>
                    <div className="text-sm uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                        {title}
                    </div>
                    {actions && <div className="flex items-center gap-2">
                        {actions}
                    </div>}
                </>
            ) : variant === 'copilot' ? (
                <div className="w-full flex items-center justify-between px-3 pt-2">
                    <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                            <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                                {title}
                            </div>
                        </div>
                    </div>
                    {rightActions}
                </div>
            ) : variant === 'playground' ? (
                <div className="w-full flex items-center justify-between px-3 pt-2">
                    <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                            <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                                {title}
                            </div>
                        </div>
                    </div>
                    {rightActions}
                </div>
            ) : isEntityList ? (
                <div className="flex items-center justify-between w-full">
                    {title}
                    {actions && <div className="flex items-center gap-2">
                        {actions}
                    </div>}
                </div>
            ) : (
                <>
                    {title}
                    {rightActions}
                </>
            )}
        </div>
        <div className={clsx(
            "min-h-0 flex-1 overflow-y-auto",
            (variant === 'projects' || isEntityList) && "custom-scrollbar"
        )}>
            {(variant === 'projects' || isEntityList) ? (
                <div className="px-4 py-3">
                    {children}
                </div>
            ) : (
                children
            )}
        </div>
    </div>;
}