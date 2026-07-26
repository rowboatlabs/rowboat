/**
 * Prompt strings the renderer sends to the copilot on behalf of a UI affordance
 * (suggested-topic card, live-note setup, background-task setup/edit).
 *
 * Extracted verbatim from App.tsx — pure string building, no React.
 */

export const getSuggestedTopicTargetFolder = (category?: string) => {
  const normalized = category?.trim().toLowerCase()
  switch (normalized) {
    case 'people':
    case 'person':
      return 'People'
    case 'organizations':
    case 'organization':
      return 'Organizations'
    case 'projects':
    case 'project':
      return 'Projects'
    case 'meetings':
    case 'meeting':
      return 'Meetings'
    case 'topics':
    case 'topic':
    default:
      return 'Topics'
  }
}

export const buildSuggestedTopicExplorePrompt = ({
  title,
  description,
  category,
}: {
  title: string
  description: string
  category?: string
}) => {
  const folder = getSuggestedTopicTargetFolder(category)
  const categoryLabel = category?.trim() || 'Topics'
  return [
    'I am exploring a suggested topic card from the Suggested Topics panel.',
    'This card may represent a person, organization, topic, or project.',
    '',
    'Card context:',
    `- Title: ${title}`,
    `- Category: ${categoryLabel}`,
    `- Description: ${description}`,
    `- Target folder if we set this up: knowledge/${folder}/`,
    '',
    `Please start by telling me that you can set up a live note for "${title}" under knowledge/${folder}/.`,
    'Then briefly explain what that live note would track and ask me if you should set it up.',
    'Do not create or modify anything yet.',
    'Treat a clear confirmation from me as explicit approval to proceed.',
    `If I confirm later, load the \`live-note\` skill first, check whether a matching note already exists under knowledge/${folder}/, and extend its existing live objective instead of creating a duplicate.`,
    `If no matching note exists, create a new note under knowledge/${folder}/ with an appropriate filename.`,
    'Make the new note live (add a `live:` block to its frontmatter) rather than only writing static content, and keep any surrounding note scaffolding short and useful.',
    'Do not ask me to choose a note path unless there is a real ambiguity you cannot resolve from the card.',
  ].join('\n')
}

export const buildLiveNoteSetupPrompt = () =>
  'I want to set up a Live note / task.'

export const buildBgTaskSetupPrompt = (description: string) =>
  `Create a background task for me. Here's what I want it to do:\n\n${description}`

export const buildBgTaskEditPrompt = (slug: string) =>
  `Let's tweak the background task \`${slug}\`. Please load the \`background-task\` skill first, read the task's current \`bg-tasks/${slug}/task.yaml\`, then ask me what I want to change.`
