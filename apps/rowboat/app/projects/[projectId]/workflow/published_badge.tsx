import { RadioIcon } from "lucide-react";

export function PublishedBadge() {
    return (
        <div className="bg-green-500/10 rounded-md px-2 py-1 flex items-center gap-1">
            <RadioIcon size={16} className="text-green-500" />
            <div className="text-green-500 text-xs font-medium uppercase">Активно</div>
        </div>
    );
}
