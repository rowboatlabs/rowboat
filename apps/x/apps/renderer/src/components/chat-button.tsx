import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ChatButtonProps {
  onClick: () => void
}

export function ChatButton({ onClick }: ChatButtonProps) {
  return (
    <Button
      onClick={onClick}
      size="icon"
      className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow z-50"
    >
      <MessageSquare className="h-5 w-5" />
    </Button>
  )
}
