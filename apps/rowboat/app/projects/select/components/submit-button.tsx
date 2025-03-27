'use client';
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { useFormStatus } from "react-dom";

export function Submit() {
    const { pending } = useFormStatus();

    return <>
        {pending && <div className="text-gray-400">Please hold on while we set up your project&hellip;</div>}
        <Button
            type="submit"
            startContent={<PlusIcon size={16} />}
            isLoading={pending}
        >
            Create project
        </Button>
    </>;
} 