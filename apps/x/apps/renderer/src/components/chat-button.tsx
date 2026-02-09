import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChatInputBarProps {
  onSubmit: (message: string) => void
  onOpen: () => void
}

export function ChatInputBar({ onSubmit, onOpen }: ChatInputBarProps) {
  const [message, setMessage] = useState('')

  const handleSubmit = () => {
    const trimmed = message.trim()
    if (trimmed) {
      onSubmit(trimmed)
      setMessage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFocus = () => {
    onOpen()
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="flex items-center gap-2 bg-background border border-border rounded-lg shadow-none px-4 py-2.5 w-80">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Ask anything..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!message.trim()}
          className={cn(
            "h-7 w-7 rounded-full shrink-0 transition-all",
            message.trim()
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground"
          )}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
