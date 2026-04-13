import path from "path";
import fs from "fs";
import { WorkDir } from "../config/config.js";

export type TagApplicability = 'email' | 'notes' | 'both';

export type TagType =
  | 'relationship'
  | 'relationship-sub'
  | 'topic'
  | 'email-type'
  | 'noise'
  | 'action'
  | 'status'
  | 'source';

export type NoteEffect = 'create' | 'skip' | 'none';

export interface TagDefinition {
  tag: string;
  type: TagType;
  applicability: TagApplicability;
  description: string;
  example?: string;
  /** Whether an email with this tag should create notes ('create'), be skipped ('skip'), or has no effect on note creation ('none'). */
  noteEffect?: NoteEffect;
}

// ── Default definitions (used to seed WorkDir/config/tags.json) ─────────────

const DEFAULT_TAG_DEFINITIONS: TagDefinition[] = [
  // ── Relationship — who is this from/about (all create) ────────────────
  { tag: 'investor', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Investors, VCs, or angels', example: 'Following up on our meeting — we\'d like to move forward with the Series A term sheet.' },
  { tag: 'customer', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Paying customers', example: 'We\'re seeing great results with Rowboat. Can we discuss expanding to more teams?' },
  { tag: 'prospect', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Potential customers', example: 'Thanks for the demo yesterday. We\'re interested in starting a pilot.' },
  { tag: 'partner', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Business partners, corp dev, or strategic contacts', example: 'Let\'s discuss how we can promote the integration to both our user bases.' },
  { tag: 'vendor', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Service providers you already pay or have a contract with (legal, accounting, infra). NOT someone pitching their services to you — that is cold-outreach.', example: 'Here are the updated employment agreements you requested.' },
  { tag: 'candidate', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Job applicants, recruiters, and anyone reaching out about roles — both solicited and unsolicited', example: 'Thanks for reaching out. I\'d love to learn more about the engineering role.' },
  { tag: 'team', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Internal team members and co-founders', example: 'Here\'s the updated roadmap for Q2. Let\'s discuss in our sync.' },
  { tag: 'advisor', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Advisors, mentors, or board members', example: 'I\'ve reviewed the deck. Here are my thoughts on the GTM strategy.' },
  { tag: 'personal', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Family or friends', example: 'Are you coming to Thanksgiving this year? Let me know your travel dates.' },
  { tag: 'press', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Journalists or media', example: 'I\'m writing a piece on AI agents. Would you be available for an interview?' },
  { tag: 'community', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Peers, YC batchmates, or open source contributors with direct interaction', example: 'Love what you\'re building with Rowboat. Here\'s a bug I found...' },
  { tag: 'government', type: 'relationship', applicability: 'both', noteEffect: 'create', description: 'Government agencies', example: 'Your Delaware franchise tax is due by March 1, 2025.' },

  // ── Relationship Sub-Tags — role metadata (notes only, all none) ──────
  { tag: 'primary', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Main contact or decision maker', example: 'Sarah Chen — VP Engineering, your main point of contact at Acme.' },
  { tag: 'secondary', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Supporting contact, involved but not the lead', example: 'David Kim — Engineer CC\'d on customer emails.' },
  { tag: 'executive-assistant', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'EA or admin handling scheduling and logistics', example: 'Lisa — Sarah\'s EA who schedules all her meetings.' },
  { tag: 'cc', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Person who\'s CC\'d but not actively engaged', example: 'Manager looped in for visibility on deal.' },
  { tag: 'referred-by', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Person who made an introduction or referral', example: 'David Park — Investor who intro\'d you to Sarah.' },
  { tag: 'former', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Previously held this relationship, no longer active', example: 'John — Former customer who churned last year.' },
  { tag: 'champion', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Internal advocate pushing for you', example: 'Engineer who loves your product and is selling internally.' },
  { tag: 'blocker', type: 'relationship-sub', applicability: 'notes', noteEffect: 'none', description: 'Person opposing or blocking progress', example: 'CFO resistant to spending on new tools.' },

  // ── Topic — what the email is about (all create) ──────────────────────
  { tag: 'sales', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Sales conversations, deals, and revenue', example: 'Here\'s the pricing proposal we discussed. Let me know if you have questions.' },
  { tag: 'support', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Help requests, issues, and customer support', example: 'We\'re seeing an error when trying to export. Can you help?' },
  { tag: 'legal', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Contracts, terms, compliance, and legal matters', example: 'Legal has reviewed the MSA. Attached are our requested changes.' },
  { tag: 'finance', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Actionable money matters: invoices, payments, banking, and taxes', example: 'Your invoice #1234 for $5,000 is attached. Payment due in 30 days.' },
  { tag: 'hiring', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Recruiting, interviews, and employment', example: 'We\'d like to move forward with a final round interview. Are you available Thursday?' },
  { tag: 'fundraising', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Raising money, SAFEs, term sheets, and investor relations', example: 'Thanks for sending the deck. We\'d like to schedule a partner meeting.' },
  { tag: 'security', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Vulnerability disclosures, login alerts, brand impersonation, or compliance requests', example: 'We found a JWT bypass in your auth endpoint. Details attached.' },
  { tag: 'infrastructure', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Deploy failures, build errors, webhook issues, API migrations, and production alerts', example: 'Vercel deploy failed for rowboat-app. Build log attached.' },
  { tag: 'meeting', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Calendar invites and scheduling for real meetings with named people — investors, customers, partners, candidates, team members. The key signal is a specific person you have a relationship with.', example: 'Invitation: Zoom: Rowboat Labs <> Dalton Caldwell @ Sat 7 Mar 2026' },
  { tag: 'event', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Conferences, meetups, and gatherings you are attending or invited to', example: 'You\'re invited to speak at TechCrunch Disrupt. Can you confirm your availability?' },
  { tag: 'research', type: 'topic', applicability: 'both', noteEffect: 'create', description: 'Research requests and information gathering', example: 'Here\'s the market analysis you requested on the AI agent space.' },

  // ── Email Type — high-signal email formats (all create) ───────────────
  { tag: 'intro', type: 'email-type', applicability: 'both', noteEffect: 'create', description: 'Warm introduction from someone you know', example: 'I\'d like to introduce you to Sarah Chen, VP Engineering at Acme.' },
  { tag: 'followup', type: 'email-type', applicability: 'both', noteEffect: 'create', description: 'Following up on a previous two-way conversation (both parties have engaged). A cold sender bumping their own unanswered email is NOT a followup — it is cold-outreach.', example: 'Following up on our call last week. Have you had a chance to review the proposal?' },

  // ── Noise — all skip signals in one place ─────────────────────────────
  // NOTE: Noise tags override relationship/topic tags. An email can have
  // relationship: team AND filter: receipt — the noise tag wins and skips note creation.
  { tag: 'spam', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Junk and unwanted email, including Google Groups spam moderation digests (from noreply-spamdigest)', example: 'Congratulations! You\'ve won $1,000,000...' },
  { tag: 'promotion', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Marketing offers, sales pitches, product launches, event invitations you did not register for, startup program upsells, vendor upgrade campaigns, and webinar/workshop invitations from companies', example: 'Register Now! Experts talk live: AI, Marketplace, Architecture & GTM Sessions Coming Up' },
  { tag: 'cold-outreach', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Unsolicited contact from someone you have no prior engagement with — includes design agencies, compliance firms, content/copy writers, dev shops, freelancers offering free work, trademark services, company closure services, hiring platforms, and anyone pitching a service with "exclusive YC deal" or referencing your YC batch. Even if they mention your company by name or offer something free.', example: 'Ramnique, $2000 worth YC Design deal every month — we work with 230+ YC founders' },
  { tag: 'newsletter', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Newsletters, industry reports, subscription emails, product tips/tutorials from vendors, and research digests — even from platforms you actively use', example: 'Report: $1.2T in combined enterprise AI value — but what\'s actually built to last?' },
  { tag: 'notification', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Automated system messages requiring no decision: email verifications, meeting recording uploads, platform policy/permission changes, billing console updates, password resets, and expired OTPs', example: 'Meeting records: your recording has been uploaded to Google Drive.' },
  { tag: 'digest', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Community digests, forum roundups, and aggregated updates', example: 'YC Bookface Weekly: 12 new posts this week...' },
  { tag: 'product-update', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Product changelogs, feature announcements, and vendor marketing disguised as tips', example: 'Discover more with your Upstash free account — popular use cases inside' },
  { tag: 'receipt', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Completed transaction confirmations with no decision remaining: payment receipts, salary/payroll disbursements, tax payment acknowledgements (challans), GST/VAT filing confirmations (GSTR1 ARNs), TDS workings, recurring invoice-sharing threads, and transfer-initiated confirmations', example: 'Challan payment under section 200 for TAN BLXXXXXX4B has been successfully paid.' },
  { tag: 'social', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Social media notifications', example: 'John Smith commented on your post.' },
  { tag: 'forums', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Mailing lists, group discussions, and Google Groups moderation digests that are not spam digests', example: 'Re: [dev-list] Question about API design' },
  { tag: 'scheduling', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Automated meeting reminders, scheduling tool confirmations, and calendar system notifications with no named person or context. NOT real meeting invites with specific people — those are topic: meeting.', example: 'Reminder: your meeting is about to start. Join with Google Meet.' },
  { tag: 'travel', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Flights, hotels, trips, and travel logistics', example: 'Your flight to Tokyo on March 15 is confirmed. Confirmation #ABC123.' },
  { tag: 'shopping', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Purchases, orders, and returns', example: 'Your order #12345 has shipped. Track it here.' },
  { tag: 'health', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Medical, wellness, and health-related matters', example: 'Your appointment with Dr. Smith is confirmed for Monday at 2pm.' },
  { tag: 'learning', type: 'noise', applicability: 'email', noteEffect: 'skip', description: 'Courses, webinars, workshops, knowledge sessions, and education marketing — even from platforms you are enrolled in', example: 'Welcome to the Advanced Python course. Here\'s your access link.' },

  // ── Action — urgency signals (all create) ─────────────────────────────
  { tag: 'action-required', type: 'action', applicability: 'both', noteEffect: 'create', description: 'Needs a response or action from you', example: 'Can you send me the pricing by Friday?' },
  { tag: 'urgent', type: 'action', applicability: 'both', noteEffect: 'create', description: 'Time-sensitive, needs immediate attention', example: 'We need your signature on the contract by EOD today or we lose the deal.' },
  { tag: 'waiting', type: 'action', applicability: 'both', noteEffect: 'create', description: 'Waiting on a response from them' },

  // ── Status — workflow state (all none) ────────────────────────────────
  { tag: 'unread', type: 'status', applicability: 'email', noteEffect: 'none', description: 'Not yet processed' },
  { tag: 'to-reply', type: 'status', applicability: 'email', noteEffect: 'none', description: 'Need to respond' },
  { tag: 'done', type: 'status', applicability: 'email', noteEffect: 'none', description: 'Handled, can be archived' },
  { tag: 'active', type: 'status', applicability: 'notes', noteEffect: 'none', description: 'Currently relevant, recent activity' },
  { tag: 'archived', type: 'status', applicability: 'notes', noteEffect: 'none', description: 'No longer active, kept for reference' },
  { tag: 'stale', type: 'status', applicability: 'notes', noteEffect: 'none', description: 'No activity in 60+ days, needs attention or archive' },

  // ── Source — origin metadata (notes only, all none) ───────────────────
  { tag: 'email', type: 'source', applicability: 'notes', noteEffect: 'none', description: 'Created or updated from email' },
  { tag: 'meeting', type: 'source', applicability: 'notes', noteEffect: 'none', description: 'Created or updated from meeting transcript' },
  { tag: 'browser', type: 'source', applicability: 'notes', noteEffect: 'none', description: 'Content captured from web browsing' },
  { tag: 'web-search', type: 'source', applicability: 'notes', noteEffect: 'none', description: 'Information from web search' },
  { tag: 'manual', type: 'source', applicability: 'notes', noteEffect: 'none', description: 'Manually entered by user' },
  { tag: 'import', type: 'source', applicability: 'notes', noteEffect: 'none', description: 'Imported from another system' },
];

// ── Disk-backed config with mtime caching ──────────────────────────────────

export const TAGS_CONFIG_PATH = path.join(WorkDir, "config", "tags.json");

let cachedTagDefinitions: TagDefinition[] | null = null;
let cachedMtimeMs: number | null = null;

function ensureTagsConfigSync(): void {
  if (!fs.existsSync(TAGS_CONFIG_PATH)) {
    fs.writeFileSync(
      TAGS_CONFIG_PATH,
      JSON.stringify(DEFAULT_TAG_DEFINITIONS, null, 2) + "\n",
      "utf8",
    );
  }
}

export function getTagDefinitions(): TagDefinition[] {
  ensureTagsConfigSync();
  try {
    const stats = fs.statSync(TAGS_CONFIG_PATH);
    if (cachedTagDefinitions && cachedMtimeMs === stats.mtimeMs) {
      return cachedTagDefinitions;
    }
    const content = fs.readFileSync(TAGS_CONFIG_PATH, "utf8");
    cachedTagDefinitions = JSON.parse(content);
    cachedMtimeMs = stats.mtimeMs;
    return cachedTagDefinitions!;
  } catch {
    cachedTagDefinitions = null;
    cachedMtimeMs = null;
    return DEFAULT_TAG_DEFINITIONS;
  }
}

// ── Render helpers ───────────────────────────────────────────────────────

const TYPE_ORDER: TagType[] = [
  'relationship', 'relationship-sub', 'topic', 'email-type',
  'noise', 'action', 'status', 'source',
];

const TYPE_LABELS: Record<TagType, string> = {
  'relationship': 'Relationship',
  'relationship-sub': 'Relationship Sub-Tags',
  'topic': 'Topic',
  'email-type': 'Email Type',
  'noise': 'Noise',
  'action': 'Action',
  'status': 'Status',
  'source': 'Source',
};

function renderTagGroups(tags: TagDefinition[]): string {
  const groups = new Map<TagType, TagDefinition[]>();
  for (const tag of tags) {
    const list = groups.get(tag.type) ?? [];
    list.push(tag);
    groups.set(tag.type, list);
  }

  const sections: string[] = [];
  for (const type of TYPE_ORDER) {
    const group = groups.get(type);
    if (!group || group.length === 0) continue;

    const label = TYPE_LABELS[type];
    const rows = group.map(t => {
      const example = t.example ?? '';
      return `| ${t.tag} | ${t.description} | ${example} |`;
    });

    sections.push(
      `## ${label}\n\n` +
      `| Tag | Description | Example |\n` +
      `|-----|-------------|---------|\n` +
      rows.join('\n'),
    );
  }

  return `# Tag System Reference\n\n${sections.join('\n\n')}`;
}

export function renderNoteEffectRules(): string {
  const tags = getTagDefinitions();
  const skipByType = new Map<string, string[]>();
  const createByType = new Map<string, string[]>();

  for (const t of tags) {
    const effect = t.noteEffect ?? 'none';
    if (effect === 'none') continue;
    const label = TYPE_LABELS[t.type] ?? t.type;
    const map = effect === 'skip' ? skipByType : createByType;
    const list = map.get(label) ?? [];
    list.push(t.tag.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
    map.set(label, list);
  }

  const formatList = (map: Map<string, string[]>) =>
    Array.from(map.entries()).map(([type, tags]) => `- **${type}:** ${tags.join(', ')}`).join('\n');

  return [
    `**SKIP if the email has ANY of these labels (skip labels override everything):**`,
    formatList(skipByType),
    ``,
    `**CREATE/UPDATE notes if the email has ANY of these labels (and no skip labels present):**`,
    formatList(createByType),
    ``,
    `**Logic:** If even one label falls in the "skip" list, skip the email — skip labels are hard filters that override create labels.`,
  ].join('\n');
}

export function renderTagSystemForNotes(): string {
  const tags = getTagDefinitions().filter(t => t.applicability !== 'email');
  return renderTagGroups(tags);
}

export function renderTagSystemForEmails(): string {
  const tags = getTagDefinitions().filter(t => t.applicability !== 'notes');
  return renderTagGroups(tags);
}
