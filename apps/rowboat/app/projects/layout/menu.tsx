'use client';
import { usePathname } from "next/navigation";
import { Tooltip } from "@heroui/react";
import Link from "next/link";
import { DatabaseIcon, SettingsIcon, WorkflowIcon, PlayIcon, LucideIcon } from "lucide-react";
import MenuItem from "./components/menu-item";

interface NavLinkProps {
    href: string;
    label: string;
    icon: LucideIcon;
    collapsed?: boolean;
    selected?: boolean;
}

function NavLink({ href, label, icon, collapsed, selected = false }: NavLinkProps) {
    return (
        <Link href={href} className="block">
            <MenuItem
                icon={icon}
                selected={selected}
                collapsed={collapsed}
            >
                {label}
            </MenuItem>
        </Link>
    );
}

export default function Menu({
    projectId,
    collapsed,
    useRag,
}: {
    projectId: string;
    collapsed: boolean;
    useRag: boolean;
}) {
    const pathname = usePathname();

    return (
        <div className="flex flex-col gap-1">
            <NavLink
                href={`/projects/${projectId}/workflow`}
                label="Build"
                collapsed={collapsed}
                icon={WorkflowIcon}
                selected={pathname.startsWith(`/projects/${projectId}/workflow`)}
            />
            <NavLink
                href={`/projects/${projectId}/test`}
                label="Test"
                collapsed={collapsed}
                icon={PlayIcon}
                selected={pathname.startsWith(`/projects/${projectId}/test`)}
            />
            {useRag && (
                <NavLink
                    href={`/projects/${projectId}/sources`}
                    label="Connect"
                    collapsed={collapsed}
                    icon={DatabaseIcon}
                    selected={pathname.startsWith(`/projects/${projectId}/sources`)}
                />
            )}
            <NavLink
                href={`/projects/${projectId}/config`}
                label="Integrate"
                collapsed={collapsed}
                icon={SettingsIcon}
                selected={pathname.startsWith(`/projects/${projectId}/config`)}
            />
        </div>
    );
}
