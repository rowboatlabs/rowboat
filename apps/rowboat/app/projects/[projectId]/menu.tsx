'use client';
import { usePathname } from "next/navigation";
import { Tooltip } from "@nextui-org/react";
import Link from "next/link";
import { DatabaseIcon, SettingsIcon, WorkflowIcon, PlayIcon } from "lucide-react";
import MenuItem from "../../lib/components/menu-item";

function NavLink({ href, label, icon, collapsed, selected = false }: { 
    href: string, 
    label: string, 
    icon: React.ReactNode, 
    collapsed: boolean, 
    selected?: boolean 
}) {
    if (collapsed) {
        return (
            <Tooltip content={label} showArrow placement="right">
                <Link href={href} className="block">
                    <MenuItem
                        icon={icon}
                        selected={selected}
                        onClick={() => {}}
                    >
                        <span className="sr-only">{label}</span>
                    </MenuItem>
                </Link>
            </Tooltip>
        );
    }

    return (
        <Link href={href}>
            <MenuItem
                icon={icon}
                selected={selected}
                onClick={() => {}}
            >
                {label}
            </MenuItem>
        </Link>
    );
}

export default function Menu({
    projectId,
    collapsed,
    useDataSources,
}: {
    projectId: string;
    collapsed: boolean;
    useDataSources: boolean;
}) {
    const pathname = usePathname();

    return (
        <div className="flex flex-col gap-1">
            <NavLink
                href={`/projects/${projectId}/workflow`}
                label="Build"
                collapsed={collapsed}
                icon={<WorkflowIcon size={16} />}
                selected={pathname.startsWith(`/projects/${projectId}/workflow`)}
            />
            <NavLink
                href={`/projects/${projectId}/simulation`}
                label="Test"
                collapsed={collapsed}
                icon={<PlayIcon size={16} />}
                selected={pathname.startsWith(`/projects/${projectId}/simulation`)}
            />
            {useDataSources && (
                <NavLink
                    href={`/projects/${projectId}/sources`}
                    label="Connect"
                    collapsed={collapsed}
                    icon={<DatabaseIcon size={16} />}
                    selected={pathname.startsWith(`/projects/${projectId}/sources`)}
                />
            )}
            <NavLink
                href={`/projects/${projectId}/config`}
                label="Integrate"
                collapsed={collapsed}
                icon={<SettingsIcon size={16} />}
                selected={pathname.startsWith(`/projects/${projectId}/config`)}
            />
        </div>
    );
}
