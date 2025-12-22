"use client"

import * as React from "react"
import { ChevronRight, Clock3, FileText, Folder, Play, Plug, Rocket, Users } from "lucide-react"

import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { NavProjects } from "@/components/nav-projects"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

// This is sample data.
const data = {
  user: {
    name: "user",
    email: "user@example.com",
    avatar: "/avatars/user.jpg",
  },
  teams: [
    {
      name: "RowboatX",
      logo: Users,
      plan: "Workspace",
    },
  ],
  chatHistory: [
    { name: "Building a React Dashboard", url: "#" },
    { name: "API Integration Best Practices", url: "#" },
    { name: "TypeScript Migration Guide", url: "#" },
    { name: "Database Optimization Tips", url: "#" },
    { name: "Docker Container Setup", url: "#" },
    { name: "GraphQL vs REST API", url: "#" },
  ],
  navMain: [
    {
      title: "Scheduled",
      url: "#",
      icon: Clock3,
      isActive: false,
      items: [
        {
          title: "View Schedule",
          url: "#",
        },
        {
          title: "Create Schedule",
          url: "#",
        },
        {
          title: "Recurring Tasks",
          url: "#",
        },
      ],
    },
    {
      title: "Applets",
      url: "#",
      icon: Rocket,
      items: [
        {
          title: "Browse Applets",
          url: "#",
        },
        {
          title: "Create Applet",
          url: "#",
        },
        {
          title: "My Applets",
          url: "#",
        },
      ],
    },
  ],
}

type RowboatSummary = {
  agents: string[]
  config: string[]
  runs: string[]
}

type ResourceKind = "agent" | "config" | "run"

type SidebarSelect = (item: { kind: ResourceKind; name: string }) => void

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  onSelectResource?: SidebarSelect
}

export function AppSidebar({ onSelectResource, ...props }: AppSidebarProps) {
  const { state: sidebarState } = useSidebar()
  const [summary, setSummary] = React.useState<RowboatSummary>({
    agents: [],
    config: [],
    runs: [],
  })
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/rowboat/summary")
        if (!res.ok) return
        const data = await res.json()
        setSummary({
          agents: data.agents || [],
          config: data.config || [],
          runs: data.runs || [],
        })
      } catch (error) {
        console.error("Failed to load rowboat summary", error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Limit runs shown and provide "View more" affordance similar to chat history.
  const runsLimit = 8
  const visibleRuns = summary.runs.slice(0, runsLimit)
  const hasMoreRuns = summary.runs.length > runsLimit

  const handleSelect = (kind: ResourceKind, name: string) => {
    onSelectResource?.({ kind, name })
  }

  const navInitial = React.useMemo(
    () =>
      data.navMain.reduce<Record<string, boolean>>((acc, item) => {
        acc[item.title] = false
        return acc
      }, {}),
    []
  )

  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({
    agents: false,
    config: false,
    runs: false,
    ...navInitial,
  })

  const isCollapsed = sidebarState === "collapsed"

  React.useEffect(() => {
    if (isCollapsed) {
      setOpenGroups((prev) => {
        const closed: Record<string, boolean> = {}
        for (const key of Object.keys(prev)) closed[key] = false
        return closed
      })
    }
  }, [isCollapsed])

  const handleOpenChange = (key: string, next: boolean) => {
    if (isCollapsed) return
    setOpenGroups((prev) => ({ ...prev, [key]: next }))
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            <Collapsible
              className="group/collapsible"
              open={openGroups.agents}
              onOpenChange={(open) => handleOpenChange("agents", open)}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton className="h-9">
                    <Folder className="mr-2 h-4 w-4" />
                    <span className="truncate">Agents</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              </SidebarMenuItem>
              <CollapsibleContent asChild>
                <SidebarMenu className="pl-2">
                  {loading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
                  ) : summary.agents.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No agents found</div>
                  ) : (
                    summary.agents.map((name) => (
                      <SidebarMenuItem key={name}>
                        <SidebarMenuButton
                          className="pl-8 h-8"
                          onClick={() => handleSelect("agent", name)}
                        >
                          <FileText className="mr-2 h-3.5 w-3.5" />
                          <span className="truncate">{name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))
                  )}
                </SidebarMenu>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible
              className="group/collapsible"
              open={openGroups.config}
              onOpenChange={(open) => handleOpenChange("config", open)}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton className="h-9">
                    <Plug className="mr-2 h-4 w-4" />
                    <span className="truncate">Config</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              </SidebarMenuItem>
              <CollapsibleContent asChild>
                <SidebarMenu className="pl-2">
                  {loading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
                  ) : summary.config.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No config files</div>
                  ) : (
                    summary.config.map((name) => (
                      <SidebarMenuItem key={name}>
                        <SidebarMenuButton
                          className="pl-8 h-8"
                          onClick={() => handleSelect("config", name)}
                        >
                          <FileText className="mr-2 h-3.5 w-3.5" />
                          <span className="truncate">{name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))
                  )}
                </SidebarMenu>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible
              className="group/collapsible"
              open={openGroups.runs}
              onOpenChange={(open) => handleOpenChange("runs", open)}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton className="h-9">
                    <Play className="mr-2 h-4 w-4" />
                    <span className="truncate">Runs</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              </SidebarMenuItem>
              <CollapsibleContent asChild>
                <SidebarMenu className="pl-2">
                  {loading ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
                  ) : summary.runs.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No runs found</div>
                  ) : (
                    <>
                      {visibleRuns.map((name) => (
                        <SidebarMenuItem key={name}>
                          <SidebarMenuButton
                            className="pl-8 h-8"
                            onClick={() => handleSelect("run", name)}
                          >
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span className="truncate">{name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                      {hasMoreRuns && (
                        <SidebarMenuItem>
                          <SidebarMenuButton className="pl-8 h-8 text-muted-foreground">
                            <span className="truncate">View more…</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                    </>
                  )}
                </SidebarMenu>
              </CollapsibleContent>
            </Collapsible>

            {data.navMain.map((item) => (
              <Collapsible
                key={item.title}
              className="group/collapsible"
              open={openGroups[item.title]}
              onOpenChange={(open) => handleOpenChange(item.title, open)}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton className="h-9">
                    {item.title === "Scheduled" ? (
                      <Clock3 className="mr-2 h-4 w-4" />
                    ) : item.title === "Applets" ? (
                      <Rocket className="mr-2 h-4 w-4" />
                    ) : (
                      <Folder className="mr-2 h-4 w-4" />
                    )}
                    <span className="truncate">{item.title}</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent asChild>
                  <SidebarMenu className="pl-2">
                    {item.items?.map((sub) => (
                      <SidebarMenuItem key={sub.title}>
                        <SidebarMenuButton className="pl-8 h-8">
                          <span className="truncate">{sub.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <NavProjects projects={data.chatHistory} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
