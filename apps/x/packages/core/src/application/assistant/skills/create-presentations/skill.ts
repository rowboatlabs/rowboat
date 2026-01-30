export const skill = String.raw`
# PDF Presentation Generator Skill

## Overview

This skill enables Rowboat to create visually compelling PDF presentations from natural language requests. You have full freedom to write and execute your own code to generate presentations — install any npm packages you need, generate charts, use custom layouts, and make the output look polished and professional.

A minimal reference implementation using @react-pdf/renderer exists in the codebase at:
- **Types:** src/application/assistant/skills/create-presentations/types.ts
- **Generator:** src/application/assistant/skills/create-presentations/presentation-generator.tsx

**This code is just a starting point.** It shows one basic approach to PDF generation. You are NOT limited to it. Feel free to:
- Write your own code from scratch
- Use different libraries (e.g., pdfkit, puppeteer with HTML/CSS, jsPDF, or anything else)
- Install any npm packages you need via executeCommand
- Generate charts and visualizations (e.g., chartjs-node-canvas, d3-node, vega-lite, mermaid)
- Render charts as PNG images and embed them in slides
- Create custom layouts, gradients, decorative elements — whatever makes the presentation look great

## When to Use This Skill

Activate this skill when the user requests:
- Creating presentations, slide decks, or pitch decks
- Making PDF slides for meetings, talks, or pitches
- Generating visual summaries or reports in presentation format
- Keywords: "presentation", "slides", "deck", "pitch deck", "slide deck", "PDF presentation"

## Knowledge Sources

Before creating any presentation, gather context from the user's knowledge base:

~~~
~/.rowboat/knowledge/
├── company/
│   ├── about.md           # Company description, mission, vision
│   ├── team.md            # Founder bios, team members
│   ├── metrics.md         # KPIs, growth numbers, financials
│   ├── product.md         # Product description, features, roadmap
│   └── branding.md        # Colors, fonts, logo paths, style guide
├── fundraising/
│   ├── previous-rounds.md # Past funding history
│   ├── investors.md       # Current investors, target investors
│   ├── use-of-funds.md    # How funds will be allocated
│   └── projections.md     # Financial projections
├── market/
│   ├── problem.md         # Problem statement
│   ├── solution.md        # How product solves it
│   ├── competitors.md     # Competitive landscape
│   ├── tam-sam-som.md     # Market size analysis
│   └── traction.md        # Customer testimonials, case studies
└── assets/
    ├── logo.png           # Company logo
    ├── product-screenshots/
    └── team-photos/
~~~

**Important:** Always check for and read relevant files from ~/.rowboat/knowledge/ before generating content. If files don't exist, ask the user for the information and offer to save it for future use.

## Workflow

### Step 1: Understand the Request & Gather Preferences

Before doing anything else, ask the user about their preferences:

1. **Content density**: Should the slides be text-heavy with detailed explanations, or minimal with just key points and big numbers?
2. **Color / theme**: Do they have brand colors or a color preference? (e.g., "use our brand blue #2563eb", "dark theme", "warm tones", "professional and clean")
3. **Presentation type**: pitch deck, product demo, team intro, investor update, etc.
4. **Audience**: investors, customers, internal team, conference
5. **Tone**: formal, casual, technical, inspirational
6. **Length**: number of slides (default: 10-12 for pitch decks)

Ask these as a concise set of questions in a single message. Use any answers the user already provided in their initial request and only ask about what's missing.

### Step 2: Gather Knowledge

~~~bash
# Check what knowledge exists
ls -la ~/.rowboat/knowledge/ 2>/dev/null || echo "No knowledge directory found"

# Read relevant files based on presentation type
# For a pitch deck, prioritize:
cat ~/.rowboat/knowledge/company/about.md 2>/dev/null
cat ~/.rowboat/knowledge/market/problem.md 2>/dev/null
cat ~/.rowboat/knowledge/company/metrics.md 2>/dev/null
cat ~/.rowboat/knowledge/company/branding.md 2>/dev/null
~~~

### Step 3: Present the Outline for Approval

Before generating slides, present a structured outline to the user:

~~~
## Proposed Presentation Outline

**Title:** [Presentation Title]
**Slides:** [N] slides
**Style:** [Color scheme / theme description]

### Flow:

1. **Title Slide**
   - Company name, tagline, presenter name

2. **Problem**
   - [One sentence summary of the problem]

3. **Solution**
   - [One sentence summary of your solution]

...

---

Does this look good? I can adjust the outline, then I'll go ahead and generate the PDF for you.
- Add/remove slides
- Reorder sections
- Adjust emphasis on any area
~~~

After the user approves (or after incorporating their feedback), immediately ask: **"I'll generate the PDF now — where should I save it?"** If the user has already indicated a path or preference, skip asking and generate directly.

**IMPORTANT:** Always generate the PDF. Never suggest the user copy content into Keynote, Google Slides, or any other tool. The whole point of this skill is to produce a finished PDF.

### Step 4: Generate the Presentation

Write code to generate the presentation. You have complete freedom here:

1. **Install any packages you need** via executeCommand (e.g., npm install @react-pdf/renderer chartjs-node-canvas)
2. **Write a script** that generates the PDF — you can use the reference code as inspiration or write something entirely different
3. **Generate charts** for any data that would benefit from visualization (revenue growth, market size, traction metrics, competitive positioning, etc.) — use chartjs-node-canvas, d3, vega, or any charting library
4. **Execute the script** to produce the final PDF

## Visual Quality Guidelines

**Do NOT produce plain, boring slides.** Make them look professional and visually engaging:

- **Use color intentionally** — gradient backgrounds on title/CTA slides, accent colors for bullets and highlights, colored stat numbers
- **Apply the user's brand colors** throughout — not just on the title slide, but as accents, backgrounds, and highlights across all slides
- **Charts and visualizations** — whenever there are numbers (revenue, growth, market size, user counts), generate a chart instead of just listing numbers. Bar charts, line charts, pie charts, and simple diagrams make slides far more impactful
- **Visual hierarchy** — large bold headings, generous whitespace, clear separation between sections
- **Consistent theming** — every slide should feel like part of the same deck, with consistent colors, fonts, and spacing
- **Decorative elements** — subtle accent bars, colored bullets, gradient sections, and background tints add polish

## Slide Types (Reference)

These are common slide patterns. You can implement these or create your own:

| Type | Description | When to Use |
|------|-------------|-------------|
| Title | Bold opening with gradient/colored background | First slide |
| Section | Section divider between topics | Between major sections |
| Content | Text with bullet points | Explaining concepts, lists |
| Two-column | Side-by-side comparison | Us vs. them, before/after |
| Stats | Big bold numbers | Key metrics, traction, market size |
| Chart | Data visualization | Revenue growth, market breakdown, trends |
| Quote | Testimonial or notable quote | Customer feedback, press quotes |
| Image | Full or partial image with caption | Product screenshots, team photos |
| Team | Grid of team member cards | Team introduction |
| CTA | Call to action / closing | Final slide |

## Content Limits Per Slide

Each slide is a fixed page. Content that exceeds the available space will overflow. Follow these limits:

| Slide Type | Max Items / Content |
|------------|-------------------|
| Content | 5 bullet points max (~80 chars each). Paragraph text: max ~4 lines. |
| Two-column | 4 bullet points per column max (~60 chars each). |
| Stats | 3-4 stats max. Keep labels short. |
| Team | 4 members max per slide. Split into multiple slides if needed. |
| Quote | Keep quotes under ~200 characters. |

**If the user's content needs more space**, split it across multiple slides rather than cramming it into one.

## Pitch Deck Templates

### Series A Pitch Deck (12 slides)

1. **Title** - Company name, tagline, presenter
2. **Problem** - What pain point you solve
3. **Solution** - Your product/service
4. **Product** - Demo/screenshots
5. **Market** - TAM/SAM/SOM (use a chart!)
6. **Business Model** - How you make money
7. **Traction** - Metrics and growth (use charts!)
8. **Competition** - Positioning (two-column or matrix chart)
9. **Team** - Key team members
10. **Financials** - Projections (use a chart!)
11. **The Ask** - Funding amount and use (pie chart for allocation)
12. **Contact** - CTA with contact info

### Product Demo Deck (8 slides)

1. **Title** - Product name and tagline
2. **Problem** - User pain points
3. **Solution** - High-level approach
4. **Features** - Key capabilities (two-column)
5. **Demo** - Screenshots
6. **Pricing** - Plans and pricing
7. **Testimonials** - Customer quotes
8. **Get Started** - CTA

## Best Practices

1. **Keep slides simple** - One idea per slide
2. **Use charts for numbers** - Never just list numbers when a chart would be more impactful
3. **Limit bullet points** - 3-5 max per slide, keep them short
4. **Use two-column for comparisons** - Us vs. them, before/after
5. **End with clear CTA** - What do you want them to do?
6. **Gather knowledge first** - Check ~/.rowboat/knowledge/ before generating
7. **Use absolute paths** for images (PNG, JPG supported)
8. **Never overflow** - If content doesn't fit, split across multiple slides
9. **Make it visually rich** - Colors, charts, gradients — not just text on white backgrounds
`;

export default skill;
