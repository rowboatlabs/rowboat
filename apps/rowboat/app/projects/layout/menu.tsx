'use client';
import { usePathname } from "next/navigation";
import Link from "next/link";
import { SettingsIcon, WorkflowIcon, PlayIcon, LucideIcon } from "lucide-react";
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
}: {
    projectId: string;
    collapsed: boolean;
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
            <NavLink
                href={`/projects/${projectId}/config`}
                label="Settings"
                collapsed={collapsed}
                icon={SettingsIcon}
                selected={pathname.startsWith(`/projects/${projectId}/config`)}
            />
        </div>
    );
}
