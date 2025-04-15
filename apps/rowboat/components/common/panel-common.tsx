import clsx from "clsx";
import { Sparkles } from "lucide-react";

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
    rightActions?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    maxHeight?: string;
    variant?: 'default' | 'copilot' | 'projects';
    showWelcome?: boolean;
}

export function Panel({
    title,
    rightActions,
    actions,
    children,
    maxHeight,
    variant = 'default',
    showWelcome = true,
}: PanelProps) {
    return <div className={clsx(
        "flex flex-col overflow-hidden rounded-xl border relative",
        "border-zinc-200 dark:border-zinc-800",
        "bg-white dark:bg-zinc-900",
        maxHeight ? "max-h-[var(--panel-height)]" : "h-full"
    )}
    style={{ 
        '--panel-height': maxHeight
    } as React.CSSProperties}
    >
        {variant === 'copilot' && showWelcome && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -mt-16">
                <Sparkles className="w-32 h-32 text-blue-400/40 dark:text-blue-500/25 animate-sparkle" />
                <div className="relative mt-8 max-w-full px-8">
                    <div className="font-mono text-sm whitespace-nowrap text-blue-400/60 dark:text-blue-500/40 font-small inline-flex">
                        <div className="overflow-hidden w-0 animate-typing">What can I help you build?</div>
                        <div className="border-r-2 border-blue-400 dark:border-blue-500 animate-cursor">&nbsp;</div>
                    </div>
                </div>
            </div>
        )}
        <div className={clsx(
            "shrink-0 border-b border-zinc-100 dark:border-zinc-800 relative",
            variant === 'projects' ? "flex flex-col gap-3 px-4 py-3" : "flex items-center justify-between px-4 py-3"
        )}>
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
                <>
                    <div className="flex items-center gap-2">
                        {title}
                    </div>
                    {rightActions}
                </>
            ) : (
                <>
                    {title}
                    {rightActions}
                </>
            )}
        </div>
        <div className={clsx(
            "min-h-0 flex-1 overflow-y-auto",
            variant === 'projects' && "custom-scrollbar"
        )}>
            {variant === 'projects' ? (
                <div className="px-3 py-2 pb-4">
                    {children}
                </div>
            ) : children}
        </div>
    </div>;
}