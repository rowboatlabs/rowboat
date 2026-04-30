"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { ResolvedSkill } from "@x/shared/dist/skill.js"

interface SkillsSettingsProps {
  dialogOpen: boolean
}

export function SkillsSettings({ dialogOpen }: SkillsSettingsProps) {
  const [skills, setSkills] = useState<ResolvedSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState("")

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
    if (dialogOpen) loadSkills()
  }, [dialogOpen, loadSkills])

  const handleSelectSkill = useCallback(async (skillId: string) => {
    try {
      const skill = await window.ipc.invoke("skills:get", { id: skillId })
      if (skill) {
        setSelectedSkill(skillId)
        setSkillContent(skill.content)
      }
    } catch (err) {
      console.error("Failed to load skill:", err)
      toast.error("Failed to load skill")
    }
  }, [])

  const selectedSkillData = selectedSkill
    ? skills.find((s) => s.id === selectedSkill)
    : null

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading skills...
      </div>
    )
  }

  if (selectedSkill && selectedSkillData) {
    return (
      <div className="flex flex-col h-full overflow-hidden gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedSkill(null)}
            className="h-8 px-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{selectedSkillData.title}</div>
            <div className="text-xs text-muted-foreground truncate">{selectedSkillData.summary}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto rounded-md border bg-muted/20 p-3">
          <pre className="text-xs font-mono whitespace-pre-wrap">{skillContent}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <p className="text-xs text-muted-foreground shrink-0 mb-3">
        Skills are read-only guidance bundled with the app. Updates ship with new app releases.
      </p>
      <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
        {skills.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No skills available.
          </div>
        ) : (
          skills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleSelectSkill(skill.id)}
              className={cn(
                "w-full text-left p-3 rounded-md border bg-card hover:bg-accent transition-colors",
              )}
            >
              <div className="font-medium text-sm">{skill.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {skill.summary}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
