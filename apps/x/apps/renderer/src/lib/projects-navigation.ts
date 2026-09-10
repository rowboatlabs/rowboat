import type { Project } from '@/hooks/use-projects'

export type ProjectLocation = { path: string; runId?: string; filePath?: string }

/** Section entry restores the last project instead of opening a pathless
 * root and clearing its chats/files. History entries still apply exactly. */
export function resolveProjectsLocation(projects: Project[], previous: ProjectLocation | null): ProjectLocation | null {
    const project = projects.find((item) => previous && (previous.path === item.path || (!item.isDefault && previous.path.startsWith(`${item.path}/`))))
        ?? projects.find((item) => previous?.runId && item.chats.some((chat) => chat.id === previous.runId))
        ?? projects.find((item) => item.isDefault)
        ?? projects[0]
    if (!project) return null
    const sameProject = previous && (previous.path === project.path || (!project.isDefault && previous.path.startsWith(`${project.path}/`))
        || project.chats.some((chat) => chat.id === previous.runId))
    if (!sameProject) return { path: project.path }
    const runId = project.chats.some((chat) => chat.id === previous.runId) ? previous.runId : undefined
    // A folder rename can be recovered through its stable chat association.
    const filePath = previous.filePath?.startsWith(`${project.path}/`) ? previous.filePath
        : previous.filePath?.startsWith(`${previous.path}/`)
            ? `${project.path}${previous.filePath.slice(previous.path.length)}` : undefined
    return { path: project.path, ...(runId ? { runId } : {}), ...(filePath ? { filePath } : {}) }
}
