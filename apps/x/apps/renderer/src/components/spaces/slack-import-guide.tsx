import { ArrowUpRight, BookOpen, Check, Minus } from 'lucide-react'

// 2026-11-18: keep preparation and v1 boundaries beside the upload, in plain language.
export function SlackImportGuide() {
    return <details className="group rounded-xl border border-border bg-muted/20">
        <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-medium">
            <BookOpen className="size-4 text-muted-foreground" aria-hidden />
            How to export from Slack and import here
            <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">Read guide</span>
        </summary>
        <div className="space-y-5 border-t border-border p-4 text-sm leading-relaxed">
            <section className="space-y-2">
                <h3 className="font-semibold">1. Download your Slack export</h3>
                <p>You need permission to export the Slack workspace. If the export option is missing, ask your workspace owner.</p>
                <ol className="list-decimal space-y-2 pl-5">
                    <li>On Slack desktop, open <strong>Admin → Workspace settings → Security → Import &amp; export data</strong>.</li>
                    <li>Open the <strong>Export</strong> tab, choose a date range, and start the export. Choose JSON if Slack offers a format choice.</li>
                    <li>Wait for Slack’s email, return to the export page, and download the ZIP. Keep it zipped.</li>
                </ol>
                <p className="text-muted-foreground">Enterprise: open your organization menu → Tools &amp; settings → Organization settings → Security → Exports. Choose a JSON export for a specific workspace. Nested multi-workspace archives and TXT exports are not supported here.</p>
                <p className="text-muted-foreground">Public-channel exports are available on all Slack plans. Private-channel exports depend on your plan and approved export permissions. Only history included in your export can be imported.</p>
                <a href="https://slack.com/help/articles/201658943-Export-your-workspace-data" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Slack’s export instructions<ArrowUpRight className="size-3.5" aria-hidden /></a>
            </section>
            <section className="space-y-2">
                <h3 className="font-semibold">2. Review and import in Rowboat</h3>
                <ol className="list-decimal space-y-2 pl-5">
                    <li>Open <strong>New space → Import from Slack</strong>, or <strong>Space settings → Imports</strong> to import later.</li>
                    <li>Choose your ZIP below. Uploading only checks the export; it does not create spaces yet.</li>
                    <li>Select the channels you want and read any warnings. Each selected channel becomes its own space, even when you start from an existing space’s settings.</li>
                    <li>Enter the original Slack workspace domain, such as <strong>team.slack.com</strong>, then start the import. You can leave this screen while it runs.</li>
                    <li>Return to Recent imports to check progress, open imported spaces, or retry unfinished channels after a failure.</li>
                </ol>
            </section>
            <section className="space-y-2">
                <h3 className="font-semibold">What comes across?</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background p-3">
                        <h4 className="mb-2 flex items-center gap-2 font-medium"><Check className="size-4" aria-hidden />Included when present</h4>
                        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                            <li>Public and private channel message history</li>
                            <li>Threads, timestamps, and original sender names</li>
                            <li>Basic formatting and readable mentions</li>
                            <li>Historical reactions and file links</li>
                            <li>Archived-channel state and exported edit/deletion markers</li>
                        </ul>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                        <h4 className="mb-2 flex items-center gap-2 font-medium"><Minus className="size-4" aria-hidden />Not included in v1</h4>
                        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                            <li>Downloaded attachments: links may still require Slack access</li>
                            <li>Direct messages, group DMs, and canvases</li>
                            <li>Automatic accounts, invitations, roles, or channel access</li>
                            <li>Slack apps, workflows, or custom emoji images</li>
                            <li>History missing from the export or a full edit history</li>
                        </ul>
                    </div>
                </div>
            </section>
            <section className="space-y-2">
                <h3 className="font-semibold">3. Invite people and map senders</h3>
                <p>Each new space initially contains only you. Invite people separately. As a space admin, click an imported Slack sender and choose an existing Rowboat member. Their imported messages then show that member’s name, avatar, and profile. This is optional and can be changed or removed using Sender mapping.</p>
                <p className="text-muted-foreground">The original Slack sender ID stays saved. Mapping does not invite anyone or grant access. Historical mentions and reactions do not send new notifications.</p>
            </section>
            <section className="space-y-2">
                <h3 className="font-semibold">Importing more history later</h3>
                <p>Upload another export using the same workspace domain. Previously imported channels are skipped by default. Choose “Append new messages” to add unseen messages to your previous destinations; you must still be an admin there. Existing messages, edits, and deletions are not synchronized.</p>
                <p className="text-muted-foreground">Up to 100 channels per import. ZIP files can be up to 100 MiB; the export must also stay within 100 MiB unpacked, 10 MiB per file, and 100,000 records. If a limit is reached, export a smaller date range and import in batches. A smaller ZIP alone may not reduce the unpacked size.</p>
            </section>
        </div>
    </details>
}
