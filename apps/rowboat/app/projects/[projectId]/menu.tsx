'use client';
import { usePathname } from "next/navigation";
import { Tooltip } from "@nextui-org/react";
import Link from "next/link";
import clsx from "clsx";
import { DatabaseIcon, SettingsIcon, WorkflowIcon, PlayIcon } from "lucide-react";

function NavLink({ href, label, icon, collapsed, selected = false }: { href: string, label: string, icon: React.ReactNode, collapsed: boolean, selected?: boolean }) {
    return <Link
        href={href}
        className={clsx("flex px-2 py-2 gap-2 items-center rounded-lg text-sm hover:text-black", {
            "text-black": selected,
            "justify-center": collapsed,
        })}
    >
        {collapsed && <Tooltip content={label} showArrow placement="right">
            <div className="shrink-0">
                {icon}
            </div>
        </Tooltip>}
        {!collapsed && <div className="shrink-0">
            {icon}
        </div>}
        {!collapsed && <div className="truncate">
            {label}
        </div>}
    </Link>;
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

    return <div className="flex flex-col text-gray-500">
        {/* <NavLink
            href={`/projects/${projectId}/playground`}
            label="Playground"
            collapsed={collapsed}
            icon=<svg className="w-[24px] h-[24px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 17h6l3 3v-3h2V9h-2M4 4h11v8H9l-3 3v-3H4V4Z" />
            </svg>
            selected={pathname.startsWith(`/projects/${projectId}/playground`)}
        /> */}
        <NavLink
            href={`/projects/${projectId}/workflow`}
            label="Build"
            collapsed={collapsed}
            icon={<WorkflowIcon size={16} />}
            selected={pathname.startsWith(`/projects/${projectId}/workflow`)}
        />
        <NavLink
            href={`/projects/${projectId}/simulation`}
            label="Test (wip)"
            collapsed={collapsed}
            icon={<PlayIcon size={16} />}
            selected={pathname.startsWith(`/projects/${projectId}/simulation`)}
        />
        {useDataSources && <NavLink
            href={`/projects/${projectId}/sources`}
            label="Connect"
            collapsed={collapsed}
            icon={<DatabaseIcon size={16} />}
            selected={pathname.startsWith(`/projects/${projectId}/sources`)}
        />}
        <NavLink
            href={`/projects/${projectId}/config`}
            label="Integrate"
            collapsed={collapsed}
            icon={<SettingsIcon size={16} />}
            selected={pathname.startsWith(`/projects/${projectId}/config`)}
        />
        {/*<NavLink
            href={`/projects/${projectId}/integrate`}
            label="Integrate"
            collapsed={collapsed}
            icon=<svg className="w-[24px] h-[24px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="m8 8-4 4 4 4m8 0 4-4-4-4m-2-3-4 14" />
            </svg>
            selected={pathname.startsWith(`/projects/${projectId}/integrate`)}
        />*/}
    </div>;
}