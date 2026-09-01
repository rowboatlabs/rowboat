import { useState } from 'react'
import { Plus, SmilePlus, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { EmojiPickerPopover } from '@/components/spaces/emoji-picker'
import {
    POLL_ANSWER_MAX, POLL_DEFAULT_HOURS, POLL_DURATIONS, POLL_MAX_ANSWERS, POLL_QUESTION_MAX,
} from '@/lib/spaces-poll'

// Poll creation, the Discord flow: a question, 2–10 answers each with an
// optional emoji, a duration picker (24h default), and an allow-multiple
// toggle. Opened by /poll.

interface DraftAnswer {
    text: string
    emoji?: string
}

export function PollDialog({ onClose, onSubmit }: {
    onClose: () => void
    /** Posts the poll; a throw keeps the dialog open (the caller toasts). */
    onSubmit: (input: spaces.SpacesNewPollInput) => Promise<void>
}) {
    const [question, setQuestion] = useState('')
    const [answers, setAnswers] = useState<DraftAnswer[]>([{ text: '' }, { text: '' }])
    const [hours, setHours] = useState(POLL_DEFAULT_HOURS)
    const [multi, setMulti] = useState(false)
    const [posting, setPosting] = useState(false)

    const filled = answers.map((a) => ({ ...a, text: a.text.trim() })).filter((a) => a.text.length > 0)
    const canSubmit = question.trim().length > 0 && filled.length >= 2 && !posting

    const setAnswer = (i: number, patch: Partial<DraftAnswer>) =>
        setAnswers((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)))
    const removeAnswer = (i: number) => setAnswers((prev) => prev.filter((_, j) => j !== i))

    const submit = async () => {
        if (!canSubmit) return
        setPosting(true)
        try {
            await onSubmit({
                question: question.trim().slice(0, POLL_QUESTION_MAX),
                answers: filled.map((a) => ({ text: a.text, ...(a.emoji ? { emoji: a.emoji } : {}) })),
                durationHours: hours,
                allowMultiselect: multi,
            })
            onClose()
        } catch {
            // The caller toasted; the draft stays for another try.
        } finally {
            setPosting(false)
        }
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Create a poll</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-muted-foreground">Question</label>
                        <Input
                            autoFocus
                            value={question}
                            maxLength={POLL_QUESTION_MAX}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="What should we do?"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Answers</label>
                        {answers.map((answer, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                                <EmojiPickerPopover onPick={(emoji) => setAnswer(i, { emoji })}>
                                    <button
                                        type="button"
                                        title={answer.emoji ? 'Change emoji' : 'Add emoji'}
                                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                                    >
                                        {answer.emoji ? <span className="text-base leading-none">{answer.emoji}</span> : <SmilePlus className="size-4" />}
                                    </button>
                                </EmojiPickerPopover>
                                <Input
                                    value={answer.text}
                                    maxLength={POLL_ANSWER_MAX}
                                    onChange={(e) => setAnswer(i, { text: e.target.value })}
                                    placeholder={`Answer ${i + 1}`}
                                />
                                {answers.length > 2 && (
                                    <button
                                        type="button"
                                        title="Remove answer"
                                        onClick={() => removeAnswer(i)}
                                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                        <X className="size-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {answers.length < POLL_MAX_ANSWERS && (
                            <button
                                type="button"
                                onClick={() => setAnswers((prev) => [...prev, { text: '' }])}
                                className="inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Plus className="size-3.5" /> Add answer
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Duration</label>
                            <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
                                <SelectTrigger className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {POLL_DURATIONS.map((d) => (
                                        <SelectItem key={d.hours} value={String(d.hours)}>{d.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <label className="flex items-center gap-2 pt-4 text-xs font-medium text-muted-foreground">
                            <Switch checked={multi} onCheckedChange={setMulti} />
                            Allow multiple answers
                        </label>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void submit()} disabled={!canSubmit}>
                        {posting ? 'Posting…' : 'Post poll'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
