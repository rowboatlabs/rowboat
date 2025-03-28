export const paneEffects = {
    base: "transition-all duration-300 h-full",
    hover: "hover:scale-[1.03] hover:z-10",
    active: "scale-[1.03] z-10",
    inactive: "scale-[0.97] opacity-70 [&>*]:opacity-60"
} as const;

// Helper function to get all classes for a pane
export function getPaneClasses(isActive: boolean, isOtherPaneActive: boolean) {
    return [
        paneEffects.base,
        paneEffects.hover,
        isActive && paneEffects.active,
        isOtherPaneActive && paneEffects.inactive
    ];
} 