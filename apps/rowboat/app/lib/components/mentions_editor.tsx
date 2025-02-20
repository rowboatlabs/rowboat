"use client"
import { useEffect, useRef } from 'react';
import Quill, { Delta, Op } from 'quill';
import { Mention, MentionBlot, MentionBlotData } from "quill-mention";
import "quill/dist/quill.snow.css";
import "./mentions-editor.css";
import { CopyIcon } from 'lucide-react';
import { CopyButton } from './copy-button';

export type Match = {
    id: string;
    value: string;
    invalid?: boolean;
    [key: string]: string | boolean | undefined;
};

class CustomMentionBlot extends MentionBlot {
    static render(data: any) {
        const element = document.createElement('span');
        element.className = data.invalid ? 'invalid' : '';
        element.textContent = data.invalid ? `${data.value} (!)` : data.value;
        return element;
    }
}

Quill.register('blots/mention', CustomMentionBlot);
Quill.register('modules/mention', Mention);

function markdownToParts(markdown: string, atValues: Match[]): (string | Match)[] {
    // Regex match for pattern [@type:name](#type:something) where type is tool/prompt/agent
    const mentionRegex = /\[@(tool|prompt|agent):([^\]]+)\]\(#mention\)/g;
    const parts: (string | Match)[] = [];

    let lastIndex = 0;
    let match;

    // Find all matches and build the parts array
    while ((match = mentionRegex.exec(markdown)) !== null) {
        // Add text before the match if there is any
        if (match.index > lastIndex) {
            parts.push(markdown.slice(lastIndex, match.index));
        }

        // check if the match is valid
        const matchValue = `${match[1]}:${match[2]}`;
        const isInvalid = !atValues.some(atValue => atValue.id === matchValue);

        // parse the match into a mention
        parts.push({
            id: `${match[1]}:${match[2]}`,
            value: `${match[1]}:${match[2]}`,
            invalid: isInvalid,
        });

        lastIndex = match.index + match[0].length;
    }

    // Add any remaining text after the last match
    if (lastIndex < markdown.length) {
        parts.push(markdown.slice(lastIndex));
    }

    return parts;
}

function insertPartsIntoQuill(quill: Quill, parts: (string | Match)[]) {
    let index = 0;
    for (const part of parts) {
        if (typeof part === 'string') {
            quill.insertText(index, part, Quill.sources.SILENT);
            index += part.length;
        } else {
            quill.insertEmbed(index, 'mention', {
                id: part.id,
                value: part.value,
                denotationChar: '@',
                invalid: part.invalid,
            }, Quill.sources.SILENT);
            index += 1;
        }
    }
}

export default function MentionEditor({
    atValues,
    value,
    placeholder,
    onValueChange,
}: {
    atValues: Match[];
    value: string;
    placeholder?: string;
    onValueChange?: (value: string) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const quillRef = useRef<Quill | null>(null);

    function getMarkdown(): string {
        if (!quillRef.current) {
            return "";
        }
        // generate markdown representation of content
        const markdown = quillRef.current.getContents().map((op) => {
            if (op.insert && typeof op.insert === 'object' && 'mention' in op.insert) {
                const mentionOp = op.insert as { mention: Match };
                return `[@${mentionOp.mention.id}](#mention)`;
            }
            return op.insert;
        }).join('');
        return markdown;
    }

    function copyHandler() {
        if (!quillRef.current) {
            return;
        }
        navigator.clipboard.writeText(getMarkdown());
    }

    useEffect(() => {
        if (!containerRef.current) {
            return;
        }

        function load() {
            if (!containerRef.current) {
                return;
            }
            const quill = new Quill(containerRef.current, {
                theme: 'snow',
                formats: ["mention"],
                placeholder,
                modules: {
                    toolbar: false,
                    mention: {
                        allowedChars: /^[A-Za-z0-9_]*$/,
                        mentionDenotationChars: ["@"],
                        showDenotationChar: true,
                        source: async function (searchTerm: string, renderList: (values: Match[], searchTerm: string) => void) {
                            if (searchTerm.length === 0) {
                                renderList(atValues, searchTerm);
                            } else {
                                const matches = [];
                                for (let i = 0; i < atValues.length; i++) {
                                    if (
                                        atValues[i].value.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1
                                    ) {
                                        matches.push(atValues[i]);
                                    }
                                }
                                renderList(matches, searchTerm);
                            }
                        },
                        renderItem: (item: Match) => {
                            const div = document.createElement('div');
                            div.className = "px-2 py-1 bg-white text-blue-800 hover:bg-blue-100 cursor-pointer";
                            div.textContent = item.id;
                            return div;
                        },
                    }
                }
            });

            // clear the quill contents
            quill.setContents([]);

            // convert the markdown to parts
            const parts = markdownToParts(value, atValues);
            insertPartsIntoQuill(quill, parts);

            quill.on(Quill.events.TEXT_CHANGE, (delta: Delta, oldDelta: Delta, source: string) => {
                if (onValueChange) {
                    onValueChange(getMarkdown());
                }
            });
            quillRef.current = quill;
        }

        load();

        return () => {
            if (quillRef.current) {
                quillRef.current.off(Quill.events.TEXT_CHANGE);
            }
        }
    }, [atValues, onValueChange, placeholder, value]);

    return <div className="relative">
        <button className="absolute top-2 right-2 z-10">
            <CopyButton
                onCopy={copyHandler}
                label="Copy"
                successLabel="Copied!"
            />
        </button>
        <div ref={containerRef} />
    </div>;
}