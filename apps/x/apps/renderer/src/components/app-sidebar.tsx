"use client"

import * as React from "react"
import { ChevronRight, File, Folder } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from "@/components/ui/sidebar"

type TreeNode = {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: TreeNode[]
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  tree: TreeNode[]
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelectFile: (path: string, kind: 'file' | 'dir') => void
}

export function AppSidebar({ 
  tree,
  selectedPath,
  expandedPaths,
  onSelectFile,
  ...props 
}: AppSidebarProps) {
  const { setOpen } = useSidebar()

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      {/* This is the first sidebar */}
      {/* We disable collapsible and adjust width to icon. */}
      {/* This will make the sidebar appear as icons. */}
      <Sidebar
        collapsible="none"
        className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
      >
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-1.5 md:px-0">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Files"
                    onClick={() => {
                      setOpen(true)
                    }}
                    isActive={true}
                    className="px-2.5 md:px-2"
                  >
                    <File />
                    <span>Files</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {/* This is the second sidebar */}
      {/* We disable collapsible and let it fill remaining space */}
      <Sidebar collapsible="none" className="hidden flex-1 md:flex">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Files</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {tree.map((item, index) => (
                  <Tree 
                    key={index} 
                    item={item}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    onSelect={onSelectFile}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}

type TreeProps = {
  item: TreeNode
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelect: (path: string, kind: 'file' | 'dir') => void
}

function Tree({ item, selectedPath, expandedPaths, onSelect }: TreeProps) {
  const hasChildren = item.children && item.children.length > 0
  const isExpanded = expandedPaths.has(item.path)
  const isSelected = selectedPath === item.path

  if (!hasChildren) {
    return (
      <SidebarMenuButton
        isActive={isSelected}
        className="data-[active=true]:bg-transparent"
        onClick={() => onSelect(item.path, item.kind)}
      >
        <File />
        {item.name}
      </SidebarMenuButton>
    )
  }

  return (
    <SidebarMenuItem>
      <Collapsible
        open={isExpanded}
        onOpenChange={() => onSelect(item.path, item.kind)}
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight className="transition-transform" />
            <Folder />
            {item.name}
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((subItem, index) => (
              <Tree 
                key={index} 
                item={subItem}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onSelect={onSelect}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}
