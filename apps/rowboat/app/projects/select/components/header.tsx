'use client';
import { Link } from "@heroui/react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
    return (
        <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                Select a project
            </h1>
            <Button
                variant="default"
                startContent={<PlusIcon size={18} />}
                onClick={() => window.location.href = '/projects/new'}
            >
                Create new project
            </Button>
        </div>
    );
} 