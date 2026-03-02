export const raw = `# Rowboat Tag Reference

A complete list of all tags used in Rowboat for classifying emails and notes.

---

## Overview

Tags are split into two categories based on where they're used:

| Context | Total Tags | Description |
|---------|------------|-------------|
| **Email Tags** | 42 | For labeling incoming emails |
| **Note Tags** | 47 | For classifying entities in notes |
| **Shared** | 28 | Tags that work in both contexts |

---

# Email Tags (42)

Tags for labeling and classifying incoming emails.

---

## Relationship Tags (13)

Who is this email from or about?

### \`investor\`
Email from or about investors, VCs, or angels.

**Example:** "Following up on our meeting — we'd like to move forward with the Series A term sheet."

---

### \`customer\`
Email from or about paying customers.

**Example:** "We're seeing great results with Rowboat. Can we discuss expanding to more teams?"

---

### \`prospect\`
Email from or about potential customers.

**Example:** "Thanks for the demo yesterday. We're interested in starting a pilot."

---

### \`partner\`
Email from or about business partners.

**Example:** "Let's discuss how we can promote the integration to both our user bases."

---

### \`vendor\`
Email from or about service providers you work with.

**Example:** "Here are the updated employment agreements you requested."

---

### \`product\`
Email from products or services you use (automated).

**Example:** "Your AWS bill for January 2025 is now available."

---

### \`candidate\`
Email from or about job applicants.

**Example:** "Thanks for reaching out. I'd love to learn more about the engineering role."

---

### \`team\`
Email from internal team members.

**Example:** "Here's the updated roadmap for Q2. Let's discuss in our sync."

---

### \`advisor\`
Email from advisors, mentors, or board members.

**Example:** "I've reviewed the deck. Here are my thoughts on the GTM strategy."

---

### \`personal\`
Email from family or friends.

**Example:** "Are you coming to Thanksgiving this year? Let me know your travel dates."

---

### \`press\`
Email from journalists or media.

**Example:** "I'm writing a piece on AI agents. Would you be available for an interview?"

---

### \`community\`
Email from users, peers, or open source contributors.

**Example:** "Love what you're building with Rowboat. Here's a bug I found..."

---

### \`government\`
Email from government agencies.

**Example:** "Your Delaware franchise tax is due by March 1, 2025."

---

## Topic Tags (12)

What is this email about?

### \`sales\`
Sales conversations, deals, and revenue discussions.

**Example:** "Here's the pricing proposal we discussed. Let me know if you have questions."

---

### \`support\`
Help requests, issues, and customer support.

**Example:** "We're seeing an error when trying to export. Can you help?"

---

### \`legal\`
Contracts, terms, compliance, and legal matters.

**Example:** "Legal has reviewed the MSA. Attached are our requested changes."

---

### \`finance\`
Money, invoices, payments, banking, and taxes.

**Example:** "Your invoice #1234 for $5,000 is attached. Payment due in 30 days."

---

### \`hiring\`
Recruiting, interviews, and employment.

**Example:** "We'd like to move forward with a final round interview. Are you available Thursday?"

---

### \`fundraising\`
Raising money and investor relations.

**Example:** "Thanks for sending the deck. We'd like to schedule a partner meeting."

---

### \`travel\`
Flights, hotels, trips, and travel logistics.

**Example:** "Your flight to Tokyo on March 15 is confirmed. Confirmation #ABC123."

---

### \`event\`
Conferences, meetups, parties, and gatherings.

**Example:** "You're invited to speak at TechCrunch Disrupt. Can you confirm your availability?"

---

### \`shopping\`
Purchases, orders, and returns.

**Example:** "Your order #12345 has shipped. Track it here."

---

### \`health\`
Medical, wellness, and health-related matters.

**Example:** "Your appointment with Dr. Smith is confirmed for Monday at 2pm."

---

### \`learning\`
Courses, education, and skill-building.

**Example:** "Welcome to the Advanced Python course. Here's your access link."

---

### \`research\`
Research requests and information gathering.

**Example:** "Here's the market analysis you requested on the AI agent space."

---

## Email Type Tags (6)

What kind of email is this?

### \`intro\`
Warm introduction from someone you know.

**Example:** "I'd like to introduce you to Sarah Chen, VP Engineering at Acme. I think you'd have a lot to discuss."

---

### \`followup\`
Following up on a previous conversation.

**Example:** "Following up on our call last week. Have you had a chance to review the proposal?"

---

### \`scheduling\`
Meeting and calendar scheduling.

**Example:** "Are you available for a call next Tuesday at 2pm?"

---

### \`cold-outreach\`
Unsolicited contact from someone you don't know.

**Example:** "Hi, I noticed your company is growing fast. I'd love to show you how we can help with..."

---

### \`newsletter\`
Newsletters, marketing emails, and subscriptions.

**Example:** "This week in AI: The latest developments in agent frameworks..."

---

### \`notification\`
Automated alerts, receipts, and system notifications.

**Example:** "Your password was changed successfully. If this wasn't you, contact support."

---

## Filter Tags (4)

For filtering out noise.

### \`spam\`
Junk and unwanted email.

**Example:** "Congratulations! You've won $1,000,000..."

---

### \`promotion\`
Marketing offers and sales pitches.

**Example:** "50% off all items this weekend only!"

---

### \`social\`
Social media notifications.

**Example:** "John Smith commented on your post."

---

### \`forums\`
Mailing lists and group discussions.

**Example:** "Re: [dev-list] Question about API design"

---

## Action Tags (4)

What needs to happen with this email?

### \`action-required\`
Needs a response or action from you.

**Example:** "Can you send me the pricing by Friday?"

---

### \`fyi\`
Informational only, no action needed.

**Example:** "Just wanted to let you know the deal closed. Thanks for your help!"

---

### \`urgent\`
Time-sensitive and needs immediate attention.

**Example:** "We need your signature on the contract by EOD today or we lose the deal."

---

### \`waiting\`
You're waiting on a response from them.

**Usage:** Applied to threads where you've responded and are waiting for their reply.

---

## Status Tags (3)

Workflow state of the email.

### \`unread\`
Not yet processed.

---

### \`to-reply\`
Need to respond to this email.

---

### \`done\`
Handled, can be archived.

---

## Email Tag Combinations

### Customer Sales Email
\`\`\`
customer, sales, action-required
\`\`\`
"Sarah Chen (customer) sent a sales-related email that needs a response."

---

### Investor Intro
\`\`\`
investor, intro, fundraising, action-required
\`\`\`
"Warm intro to an investor, related to fundraising, needs follow-up."

---

### Travel Notification
\`\`\`
product, travel, notification, fyi
\`\`\`
"Flight confirmation from airline, just informational."

---

### Cold Recruiter
\`\`\`
cold-outreach, hiring, fyi
\`\`\`
"Unsolicited recruiter email, no action needed."

---

### Spam
\`\`\`
spam
\`\`\`
"Junk email, ignore."

---

# Note Tags (47)

Tags for classifying entities (People, Organizations, Projects, etc.) in notes.

---

## Relationship Tags (13)

What is your relationship with this entity?

### \`investor\`
Person or organization that invests in you.

**Example Person:** Alfred Lin — Partner at Sequoia, led your Series A.

**Example Org:** Sequoia — VC firm, lead investor.

---

### \`customer\`
Person or organization that pays you.

**Example Person:** Sarah Chen — VP Engineering at Acme, main buyer.

**Example Org:** Acme Corp — Enterprise customer, $50K ARR.

---

### \`prospect\`
Potential customer you're selling to.

**Example Person:** David Kim — Engineering Lead evaluating your product.

**Example Org:** TechCo — In pilot phase, decision expected Q2.

---

### \`partner\`
Person or organization you collaborate with.

**Example Person:** Lisa Park — Head of Partnerships at Stripe.

**Example Org:** Stripe — Integration partner, co-marketing.

---

### \`vendor\`
Service provider you have a relationship with.

**Example Person:** John Smith — Your accountant at Smith & Co.

**Example Org:** Wilson Sonsini — Law firm handling your contracts.

---

### \`product\`
Product or service you use (no personal relationship).

**Example Org:** AWS — Cloud provider, $2K/month.

**Example Org:** Airbnb — Travel bookings.

---

### \`candidate\`
Job applicant you're recruiting.

**Example Person:** Jane Doe — Senior Engineer candidate, final round.

---

### \`team\`
Internal team member.

**Example Person:** Ramnique Singh — Co-founder, CTO.

---

### \`advisor\`
Mentor, advisor, or board member.

**Example Person:** Michael Chen — Formal advisor, 0.5% equity.

---

### \`personal\`
Family, friends, personal contacts.

**Example Person:** Mom — Family.

**Example Person:** College roommate — Personal friend.

---

### \`press\`
Journalist or media contact.

**Example Person:** Katie Smith — Reporter at TechCrunch.

---

### \`community\`
User, peer, or open source contributor.

**Example Person:** GitHub contributor who submitted PRs.

**Example Person:** Fellow YC founder you exchange notes with.

---

### \`government\`
Government agency.

**Example Org:** IRS — Tax authority.

**Example Org:** Delaware Division of Corporations — Business registration.

---

## Relationship Sub-Tags (8)

Modifiers that add context to the primary relationship.

### \`primary\`
Main contact or decision maker.

**Example:** Sarah Chen — VP Engineering, your main point of contact at Acme.

**Usage:** \`customer\`, \`primary\`

---

### \`secondary\`
Supporting contact, involved but not the lead.

**Example:** David Kim — Engineer CC'd on customer emails.

**Usage:** \`customer\`, \`secondary\`

---

### \`executive-assistant\`
EA or admin handling scheduling and logistics.

**Example:** Lisa — Sarah's EA who schedules all her meetings.

**Usage:** \`customer\`, \`executive-assistant\`

---

### \`cc\`
Person who's CC'd but not actively engaged.

**Example:** Manager looped in for visibility on deal.

**Usage:** \`customer\`, \`cc\`

---

### \`referred-by\`
Person who made an introduction or referral.

**Example:** David Park — Investor who intro'd you to Sarah.

**Usage:** \`community\`, \`referred-by\`

---

### \`former\`
Previously held this relationship, no longer active.

**Example:** John — Former customer who churned last year.

**Usage:** \`customer\`, \`former\`

---

### \`champion\`
Internal advocate pushing for you.

**Example:** Engineer who loves your product and is selling internally.

**Usage:** \`prospect\`, \`champion\`

---

### \`blocker\`
Person opposing or blocking progress.

**Example:** CFO resistant to spending on new tools.

**Usage:** \`prospect\`, \`blocker\`

---

## Topic Tags (12)

What is this note about?

### \`sales\`
Related to sales, deals, revenue.

**Example Project:** Acme Integration — $50K deal, closing Q2.

---

### \`support\`
Related to support and help requests.

**Example Topic:** Customer Onboarding — Support process for new customers.

---

### \`legal\`
Related to contracts and legal matters.

**Example Topic:** SOC 2 Compliance — Security certification process.

---

### \`finance\`
Related to money and financial matters.

**Example Project:** Series A Fundraise — Raising $10M.

---

### \`hiring\`
Related to recruiting and employment.

**Example Project:** Q1 Hiring — 3 engineering roles to fill.

---

### \`fundraising\`
Related to raising money.

**Example Project:** Series A — $10M raise, Sequoia leading.

---

### \`travel\`
Related to travel.

**Example Travel:** Tokyo March 2025 — Business trip to meet Sony.

---

### \`event\`
Related to events and gatherings.

**Example Travel:** TechCrunch Disrupt — Speaking at conference.

---

### \`shopping\`
Related to purchases.

**Example Org:** Amazon — Product purchases.

---

### \`health\`
Related to health and wellness.

**Example Org:** One Medical — Healthcare provider.

---

### \`learning\`
Related to education and skill-building.

**Example Topic:** Machine Learning — Courses and research.

---

### \`research\`
Related to research and analysis.

**Example Topic:** Competitive Analysis — Research on competitors.

---

## Source Tags (6)

Where did this note's information come from?

### \`email\`
Note created or updated from email.

**Usage:** Applied automatically when processing email.

---

### \`meeting\`
Note created or updated from meeting transcript.

**Usage:** Applied automatically when processing meetings.

---

### \`browser\`
Content captured from web browsing.

**Usage:** Applied when using browser extension to capture.

---

### \`web-search\`
Information from web search.

**Usage:** Applied when Rowboat searches for information.

---

### \`manual\`
Manually entered by user.

**Usage:** Applied to notes you create yourself.

---

### \`import\`
Imported from another system.

**Usage:** Applied during bulk import from CRM, Notion, etc.

---

## Action Tags (3)

What needs to happen with this entity?

### \`action-required\`
Has open items or needs attention.

**Usage:** Note has unresolved open items.

---

### \`urgent\`
Time-sensitive, needs immediate attention.

**Usage:** Deadline approaching or critical situation.

---

### \`waiting\`
Waiting on something from them.

**Usage:** Ball is in their court.

---

## Note Status Tags (3)

Lifecycle state of the note.

### \`active\`
Currently relevant, recent activity.

**Usage:** Default for notes with activity in last 30 days.

---

### \`archived\`
No longer active, kept for reference.

**Usage:** Relationship ended or project completed.

---

### \`stale\`
No activity in X days, needs attention or archive.

**Usage:** Auto-applied to notes with no activity in 60+ days.

---

## Note Tag Combinations

### Primary Customer Contact
\`\`\`yaml
tags:
  - customer
  - primary
  - champion
  - sales
  - email
  - meeting
\`\`\`
"Sarah Chen — primary customer contact, champion for the deal, info from email and meetings."

---

### CC'd Engineer
\`\`\`yaml
tags:
  - customer
  - cc
  - secondary
\`\`\`
"David Kim — CC'd on customer emails, secondary contact."

---

### Executive Assistant
\`\`\`yaml
tags:
  - investor
  - executive-assistant
\`\`\`
"Lisa Park — EA for Alfred Lin at Sequoia."

---

### Former Customer
\`\`\`yaml
tags:
  - customer
  - former
  - archived
\`\`\`
"John Smith — Former customer, churned, archived for reference."

---

### Blocking Stakeholder
\`\`\`yaml
tags:
  - prospect
  - blocker
  - secondary
  - action-required
\`\`\`
"CFO at TechCo — Blocking the deal, needs to be addressed."

---

### Research Project
\`\`\`yaml
tags:
  - research
  - web-search
  - browser
  - active
\`\`\`
"Competitive Analysis — Research from web searches and browser captures."

---

# Tag Summary

## Email Tags (42)

| Category | Count | Tags |
|----------|-------|------|
| Relationship | 13 | investor, customer, prospect, partner, vendor, product, candidate, team, advisor, personal, press, community, government |
| Topic | 12 | sales, support, legal, finance, hiring, fundraising, travel, event, shopping, health, learning, research |
| Email Type | 6 | intro, followup, scheduling, cold-outreach, newsletter, notification |
| Filter | 4 | spam, promotion, social, forums |
| Action | 4 | action-required, fyi, urgent, waiting |
| Status | 3 | unread, to-reply, done |

## Note Tags (47)

| Category | Count | Tags |
|----------|-------|------|
| Relationship | 13 | investor, customer, prospect, partner, vendor, product, candidate, team, advisor, personal, press, community, government |
| Relationship Sub-Tags | 8 | primary, secondary, executive-assistant, cc, referred-by, former, champion, blocker |
| Topic | 12 | sales, support, legal, finance, hiring, fundraising, travel, event, shopping, health, learning, research |
| Source | 6 | email, meeting, browser, web-search, manual, import |
| Action | 3 | action-required, urgent, waiting |
| Status | 3 | active, archived, stale |

## Shared Tags (28)

Tags that work in both email and note contexts:

| Category | Tags |
|----------|------|
| Relationship (13) | investor, customer, prospect, partner, vendor, product, candidate, team, advisor, personal, press, community, government |
| Topic (12) | sales, support, legal, finance, hiring, fundraising, travel, event, shopping, health, learning, research |
| Action (3) | action-required, urgent, waiting |

## Email-Only Tags (14)

| Category | Tags |
|----------|------|
| Email Type (4) | scheduling, cold-outreach, newsletter, notification |
| Filter (4) | spam, promotion, social, forums |
| Action (1) | fyi |
| Status (3) | unread, to-reply, done |

## Note-Only Tags (19)

| Category | Tags |
|----------|------|
| Relationship Sub-Tags (8) | primary, secondary, executive-assistant, cc, referred-by, former, champion, blocker |
| Source (6) | email, meeting, browser, web-search, manual, import |
| Status (3) | active, archived, stale |
| Email Type (2) | intro, followup |
`;
