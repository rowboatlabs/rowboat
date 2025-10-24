"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { z } from "zod";

const UserMessage = z.object({
    role: z.literal("user"),
    content: z.string(),
});

const AssistantMessage = z.object({
    role: z.literal("assistant"),
    content: z.string(),
});

const Message = z.union([UserMessage, AssistantMessage]);

const ChatContextType = z.object({
    messages: z.array(Message),
    setMessages: z.function().args(z.array(Message)).returns(z.void()),
});

const ChatContext = createContext<z.infer<typeof ChatContextType> | undefined>(undefined);

function ChatProvider({ children }: { children: React.ReactNode }) {
    const [messages, setMessages] = useState<z.infer<typeof Message>[]>([]);
    return <ChatContext.Provider value={{ messages, setMessages }}>
        {children}
    </ChatContext.Provider>
}

function useChat(): z.infer<typeof ChatContextType> {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error("useChat must be used within a ChatProvider");
    }
    return context;
}

function UserMessage({ content }: { content: string }) {
    return <div className="bg-red-50">{content}</div>;
}

function AssistantMessage({ content }: { content: string }) {
    return <div className="bg-blue-50">{content}</div>;
}

function Chat() {
    const { messages, setMessages } = useChat();

    return <div className="flex flex-col h-full">
        <div className="grow">
            {messages.map((message, index) => (
                {message.role === "user" ? (
                    <UserMessage key={index} content={message.content} />
                ) : (
                    <AssistantMessage key={index} content={message.content} />
                )}
            ))}
        </div>
        <div className="bg-blue-50 flex">
            <div className="grow">
                <Textarea />
            </div>
            <Button>Send</Button>
        </div>
    </div>;
}

export default function AssistantApp() {
    const pathname = usePathname();

    return <ChatProvider>
        <div className="flex h-full">
            <div className="bg-amber-50 w-60">
                sidebar
            </div>
            <div className="bg-blue-50 grow">
                <Chat />
            </div>
        </div>
    </ChatProvider>;
}