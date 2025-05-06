'use client';
import { useFormStatus } from "react-dom";
import clsx from 'clsx';
import { tokens } from "@/app/styles/design-tokens";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Submit() {
    const { pending } = useFormStatus();

    return (
        <div className="flex flex-col items-start gap-2">
            {pending && (
                <div className={clsx(
                    "text-sm",
                    tokens.colors.light.text.secondary,
                    tokens.colors.dark.text.secondary
                )}>
                    Please hold on while we set up your project&hellip;
                </div>
            )}
            <Button
                type="submit"
                form="create-project-form"
                variant="primary"
                size="lg"
                isLoading={pending}
                startContent={<PlusIcon size={16} />}
            >
                Создать ассистента
            </Button>
        </div>
    );
} 