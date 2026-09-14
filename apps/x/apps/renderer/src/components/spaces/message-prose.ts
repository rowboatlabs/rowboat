// Shared typography for timeline messages, thread roots, and replies.
//
// Block code is Streamdown's own card — a header (language, copy, download)
// over the highlighted body — reached through its data-streamdown hooks and
// sized down for a chat row. It renders no bare <pre> of its own (the body
// IS the <pre>), so nothing here frames a <pre>: a border and radius on it
// would draw a second box inside the card.
export const MESSAGE_PROSE =
    'text-[15px] leading-[22px] [&_p]:my-0.5 [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_ul]:my-1 [&_ol]:my-1 [&_blockquote]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground ' +
    '[&_[data-streamdown=code-block]]:my-1.5 [&_[data-streamdown=code-block]]:rounded-lg ' +
    '[&_[data-streamdown=code-block-header]]:px-2.5 [&_[data-streamdown=code-block-header]]:py-1.5 ' +
    '[&_[data-streamdown=code-block-body]]:p-2.5 [&_[data-streamdown=code-block-body]]:text-[13px] [&_[data-streamdown=code-block-body]]:leading-normal'
