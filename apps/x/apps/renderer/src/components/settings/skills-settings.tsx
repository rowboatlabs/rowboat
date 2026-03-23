"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useMemo } from "react"
import { ArrowLeft, RotateCcw, Save, Pencil, ArrowUpCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { ResolvedSkill, SkillOverride } from "@x/shared/dist/skill.js"

type ViewMode = "view" | "edit" | "compare"

interface SkillsSettingsProps {
  dialogOpen: boolean
  onExpandRequest?: (expanded: boolean) => void
}

// ── Simple line-based diff ──────────────────────────────────────────────
type DiffLine = { type: "same" | "add" | "del"; text: string }

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")

  // Simple LCS-based diff
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "same", text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "add", text: newLines[j - 1] })
      j--
    } else {
      result.push({ type: "del", text: oldLines[i - 1] })
      i--
    }
  }

  return result.reverse()
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = useMemo(() => computeDiff(oldText, newText), [oldText, newText])
  const stats = useMemo(() => {
    const added = lines.filter((l) => l.type === "add").length
    const removed = lines.filter((l) => l.type === "del").length
    return { added, removed }
  }, [lines])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 mb-2 text-xs text-muted-foreground shrink-0">
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{stats.added} added</span>
        <span className="text-red-600 dark:text-red-400 font-medium">-{stats.removed} removed</span>
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border bg-muted/20">
        <pre className="text-xs font-mono p-0 m-0">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "px-3 py-0.5 border-l-2",
                line.type === "add" && "bg-emerald-500/10 border-l-emerald-500 text-emerald-800 dark:text-emerald-300",
                line.type === "del" && "bg-red-500/10 border-l-red-500 text-red-800 dark:text-red-300 line-through opacity-70",
                line.type === "same" && "border-l-transparent text-muted-foreground"
              )}
            >
              <span className="inline-block w-6 text-right mr-3 opacity-40 select-none text-[10px]">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </span>
              {line.text || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────

export function SkillsSettings({ dialogOpen, onExpandRequest }: SkillsSettingsProps) {
  const [skills, setSkills] = useState<ResolvedSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [officialContent, setOfficialContent] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("view")
  const [saving, setSaving] = useState(false)

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true)
      const result = await window.ipc.invoke("skills:list", null)
      setSkills(result.skills)
    } catch (err) {
      console.error("Failed to load skills:", err)
      toast.error("Failed to load skills")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) {
      loadSkills()
    }
  }, [dialogOpen, loadSkills])

  // Notify parent to expand/shrink when entering/leaving compare mode
  useEffect(() => {
    onExpandRequest?.(viewMode === "compare")
  }, [viewMode, onExpandRequest])

  const handleSelectSkill = useCallback(async (skillId: string) => {
    try {
      const skill = await window.ipc.invoke("skills:get", { id: skillId })
      if (skill) {
        setSelectedSkill(skillId)
        setEditContent(skill.content)
        setViewMode("view")
      }
    } catch (err) {
      console.error("Failed to load skill:", err)
      toast.error("Failed to load skill")
    }
  }, [])

  const handleCustomize = useCallback(async () => {
    if (!selectedSkill) return
    setViewMode("edit")
  }, [selectedSkill])

  const handleSave = useCallback(async () => {
    if (!selectedSkill) return
    const skill = skills.find((s) => s.id === selectedSkill)
    if (!skill) return

    try {
      setSaving(true)
      const meta: SkillOverride = {
        base_skill_id: selectedSkill,
        base_version: skill.version,
      }
      await window.ipc.invoke("skills:saveOverride", {
        skillId: selectedSkill,
        meta,
        content: editContent,
      })
      toast.success("Skill customization saved")
      setViewMode("view")
      await loadSkills()
      const updated = await window.ipc.invoke("skills:get", { id: selectedSkill })
      if (updated) {
        setEditContent(updated.content)
      }
    } catch (err) {
      console.error("Failed to save skill override:", err)
      toast.error("Failed to save")
    } finally {
      setSaving(false)
    }
  }, [selectedSkill, editContent, skills, loadSkills])

  const handleReset = useCallback(async () => {
    if (!selectedSkill) return

    try {
      await window.ipc.invoke("skills:deleteOverride", { skillId: selectedSkill })
      toast.success("Skill reset to official version")
      await loadSkills()
      const official = await window.ipc.invoke("skills:get", { id: selectedSkill })
      if (official) {
        setEditContent(official.content)
      }
      setViewMode("view")
    } catch (err) {
      console.error("Failed to reset skill:", err)
      toast.error("Failed to reset")
    }
  }, [selectedSkill, loadSkills])

  const handleCompareUpdate = useCallback(async () => {
    if (!selectedSkill) return
    try {
      const official = await window.ipc.invoke("skills:getOfficial", { id: selectedSkill })
      if (official) {
        setOfficialContent(official.content)
        setViewMode("compare")
      }
    } catch (err) {
      console.error("Failed to load official skill:", err)
      toast.error("Failed to load official version")
    }
  }, [selectedSkill])

  const handleAcceptUpdate = useCallback(async () => {
    if (!selectedSkill) return

    try {
      await window.ipc.invoke("skills:deleteOverride", { skillId: selectedSkill })
      toast.success("Updated to latest official version")
      await loadSkills()
      const updated = await window.ipc.invoke("skills:get", { id: selectedSkill })
      if (updated) {
        setEditContent(updated.content)
      }
      setViewMode("view")
    } catch (err) {
      console.error("Failed to accept update:", err)
      toast.error("Failed to accept update")
    }
  }, [selectedSkill, loadSkills])

  const handleAcceptAndRecustomize = useCallback(async () => {
    if (!selectedSkill) return
    const skill = skills.find((s) => s.id === selectedSkill)
    if (!skill) return

    try {
      const meta: SkillOverride = {
        base_skill_id: selectedSkill,
        base_version: skill.version,
      }
      await window.ipc.invoke("skills:saveOverride", {
        skillId: selectedSkill,
        meta,
        content: editContent,
      })
      toast.success("Base version updated — your customizations are preserved")
      await loadSkills()
      setViewMode("edit")
    } catch (err) {
      console.error("Failed to update base version:", err)
      toast.error("Failed to update")
    }
  }, [selectedSkill, editContent, skills, loadSkills])

  const handleBack = useCallback(() => {
    setSelectedSkill(null)
    setViewMode("view")
  }, [])

  const selectedSkillData = skills.find((s) => s.id === selectedSkill)

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading skills...
      </div>
    )
  }

  // ── Compare view — unified diff ────────────────────────────────────
  if (selectedSkill && selectedSkillData && viewMode === "compare") {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 pb-3 border-b mb-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setViewMode("view")} className="h-7 w-7 p-0">
            <X className="size-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm">Review Update: {selectedSkillData.title}</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Changes from v{selectedSkillData.baseVersion} to v{selectedSkillData.version}
            </p>
          </div>
        </div>

        {/* Diff */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <DiffView oldText={editContent} newText={officialContent} />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-3 border-t mt-3 shrink-0">
          <Button variant="default" size="sm" onClick={handleAcceptUpdate} className="text-xs gap-1.5">
            <ArrowUpCircle className="size-3.5" />
            Accept Update
          </Button>
          <Button variant="outline" size="sm" onClick={handleAcceptAndRecustomize} className="text-xs gap-1.5">
            <Pencil className="size-3.5" />
            Keep Mine, Dismiss
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setViewMode("view")} className="text-xs">
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // ── Skill detail / editor view ─────────────────────────────────────
  if (selectedSkill && selectedSkillData) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 pb-3 border-b mb-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBack} className="h-7 w-7 p-0">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{selectedSkillData.title}</span>
              <SourceBadge source={selectedSkillData.source} baseVersion={selectedSkillData.baseVersion} />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {selectedSkillData.source === "override" && viewMode !== "edit" && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="h-7 text-xs gap-1">
                <RotateCcw className="size-3" />
                Reset
              </Button>
            )}
            {viewMode !== "edit" ? (
              <Button variant="ghost" size="sm" onClick={handleCustomize} className="h-7 text-xs gap-1">
                <Pencil className="size-3" />
                {selectedSkillData.source === "override" ? "Edit" : "Customize"}
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs gap-1">
                <Save className="size-3" />
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </div>

        {/* Update banner */}
        {selectedSkillData.hasUpdate && viewMode !== "edit" && (
          <button
            onClick={handleCompareUpdate}
            className="flex items-center gap-3 px-3 py-2.5 mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors shrink-0"
          >
            <ArrowUpCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1 text-left">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Official update available (v{selectedSkillData.version})
              </span>
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                Your version is based on v{selectedSkillData.baseVersion}. Click to review changes.
              </p>
            </div>
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300 shrink-0">
              Review →
            </span>
          </button>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {viewMode === "edit" ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full resize-none bg-muted/50 rounded-md p-3 font-mono text-xs border-0 focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
          ) : (
            <div className="h-full overflow-y-auto">
              <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground p-3 bg-muted/30 rounded-md">
                {editContent}
              </pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Skills list view ───────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto space-y-1">
      {skills.map((skill) => (
        <button
          key={skill.id}
          onClick={() => handleSelectSkill(skill.id)}
          className={cn(
            "w-full text-left px-3 py-2.5 rounded-md transition-colors",
            "hover:bg-muted/50 border border-transparent hover:border-border",
            skill.hasUpdate && "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/10"
          )}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium truncate">{skill.title}</span>
            <SourceBadge source={skill.source} baseVersion={skill.baseVersion} />
            {skill.hasUpdate && (
              <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-[10px] px-1.5 py-0">
                Update
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{skill.summary}</p>
        </button>
      ))}
    </div>
  )
}

function SourceBadge({ source, baseVersion }: { source: string; baseVersion?: string }) {
  if (source === "override") {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
        Customized{baseVersion ? ` from v${baseVersion}` : ""}
      </Badge>
    )
  }
  return null
}
