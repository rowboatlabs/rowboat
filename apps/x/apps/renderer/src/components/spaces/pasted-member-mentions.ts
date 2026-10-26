import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { spaces } from '@x/shared'
import { isDeparted } from '@/lib/spaces-direct'

export const pastedMemberMentionsKey = new PluginKey('pastedMemberMentions')

// Pasted commands need the same member atoms as picker selections. Resolve only
// unique names; quoted/code examples must remain inert (2026-10-23, Greptile QA).
export function pastedMemberMentions(members: readonly spaces.Member[]) {
    const names = new Map<string, spaces.Member[]>()
    for (const member of new Map(members.map(member => [member.id, member])).values()) {
        if (isDeparted(member)) continue
        const name = member.displayName.toLowerCase()
        if (!name || name === 'here' || name === 'rowboat') continue
        names.set(name, [...(names.get(name) ?? []), member])
    }
    const alternatives = [...names.keys()].sort((a, b) => b.length - a.length)
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = alternatives.length ? new RegExp(`(^|[\\s([{])@(${alternatives.join('|')})(?=$|[\\s,!?;:)\\]}]|\\.(?=\\s|$))`, 'giu') : null
    return new Plugin({
        key: pastedMemberMentionsKey,
        props: {
            transformPasted(slice, view) {
                if (!pattern) return slice
                const { $from } = view.state.selection
                for (let depth = 0; depth <= $from.depth; depth++) {
                    const node = $from.node(depth)
                    if (node.type.spec.code || node.type.name === 'blockquote') return slice
                }
                if (view.state.storedMarks?.some(mark => mark.type.name === 'code')) return slice
                const map = (fragment: Fragment): Fragment => {
                    const nodes: ProseMirrorNode[] = []
                    fragment.forEach(node => {
                        if (node.type.spec.code || node.type.name === 'blockquote' || node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) {
                            nodes.push(node)
                        } else if (node.isText) {
                            const text = node.text!
                            let from = 0
                            for (const match of text.matchAll(pattern)) {
                                const candidates = names.get(match[2]!.toLowerCase())!
                                if (candidates.length !== 1) continue
                                const member = candidates[0]!
                                const start = match.index! + match[1]!.length
                                if (start > from) nodes.push(view.state.schema.text(text.slice(from, start), node.marks))
                                nodes.push(view.state.schema.nodes.mention!.create({ kind: 'member', id: member.id, label: member.displayName }))
                                from = match.index! + match[0].length
                            }
                            if (from < text.length) nodes.push(view.state.schema.text(text.slice(from), node.marks))
                        } else {
                            nodes.push(node.copy(map(node.content)))
                        }
                    })
                    return Fragment.from(nodes)
                }
                return new Slice(map(slice.content), slice.openStart, slice.openEnd)
            },
        },
    })
}
