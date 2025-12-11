"use client"

import * as React from "react"
import {
  AudioWaveform,
  Bot,
  Calendar,
  Command,
  GalleryVerticalEnd,
  Play,
  Plug,
  Users,
  Zap,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

// This is sample data.
const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  teams: [
    {
      name: "Acme Inc",
      logo: GalleryVerticalEnd,
      plan: "Enterprise",
    },
    {
      name: "Acme Corp.",
      logo: AudioWaveform,
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: Command,
      plan: "Free",
    },
  ],
  navMain: [
    {
      title: "Agents",
      url: "#",
      icon: Users,
      isActive: true,
      items: [
        {
          title: "View All Agents",
          url: "#",
        },
        {
          title: "Create Agent",
          url: "#",
        },
        {
          title: "Agent Templates",
          url: "#",
        },
      ],
    },
    {
      title: "MCP",
      url: "#",
      icon: Plug,
      items: [
        {
          title: "Servers",
          url: "#",
        },
        {
          title: "Tools",
          url: "#",
        },
        {
          title: "Configuration",
          url: "#",
        },
      ],
    },
    {
      title: "Runs",
      url: "#",
      icon: Play,
      items: [
        {
          title: "Active Runs",
          url: "#",
        },
        {
          title: "History",
          url: "#",
        },
        {
          title: "Failed Runs",
          url: "#",
        },
      ],
    },
    {
      title: "Scheduled",
      url: "#",
      icon: Calendar,
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
      icon: Zap,
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
  chatHistory: [
    {
      name: "Building a React Dashboard",
      url: "#",
    },
    {
      name: "API Integration Best Practices",
      url: "#",
    },
    {
      name: "TypeScript Migration Guide",
      url: "#",
    },
    {
      name: "Database Optimization Tips",
      url: "#",
    },
    {
      name: "Docker Container Setup",
      url: "#",
    },
    {
      name: "GraphQL vs REST API",
      url: "#",
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.chatHistory} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}


