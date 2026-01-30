export const skill = String.raw`
# PDF Presentation Generator Skill

## Overview

This skill enables Rowboat to create stunning PDF presentations from natural language requests. Use the built-in **generatePresentation** tool to render slides to PDF.

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
2. **Color / theme**: Do they have brand colors or a color preference? (e.g., "use our brand blue #2563eb" or "dark theme" or "keep it default")
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
**Estimated read time:** [X] minutes

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

Once approved, call the **generatePresentation** tool with the slides JSON and output path. Apply the user's theme/color preferences from Step 1.

## Slide Types Reference

| Type | Description | Required Fields |
|------|-------------|-----------------|
| title | Opening slide with gradient background | title |
| section | Section divider with large number | title |
| content | Standard content slide | title, content or items |
| two-column | Two column layout | title, columns (array of 2) |
| stats | Big numbers display | title, stats (array of {value, label}) |
| quote | Testimonial/quote | quote |
| image | Image with caption | title, imagePath |
| team | Team member grid | title, members (array) |
| cta | Call to action / closing | title |

## Slide Type Details

### title
~~~json
{
  "type": "title",
  "title": "Company Name",
  "subtitle": "Tagline or description",
  "presenter": "Name • Context • Date"
}
~~~

### content
~~~json
{
  "type": "content",
  "title": "Slide Title",
  "content": "Optional paragraph text",
  "items": ["Bullet point 1", "Bullet point 2", "Bullet point 3"]
}
~~~

### section
~~~json
{
  "type": "section",
  "title": "Section Title",
  "subtitle": "Optional subtitle"
}
~~~

### stats
~~~json
{
  "type": "stats",
  "title": "Key Metrics",
  "stats": [
    { "value": "$5M", "label": "Revenue" },
    { "value": "150%", "label": "YoY Growth" },
    { "value": "10K+", "label": "Users" }
  ],
  "note": "Optional footnote"
}
~~~

### two-column
~~~json
{
  "type": "two-column",
  "title": "Comparison",
  "columns": [
    {
      "title": "Column A",
      "content": "Optional text",
      "items": ["Item 1", "Item 2"]
    },
    {
      "title": "Column B",
      "content": "Optional text",
      "items": ["Item 1", "Item 2"]
    }
  ]
}
~~~

### quote
~~~json
{
  "type": "quote",
  "quote": "The quote text goes here.",
  "attribution": "Person Name, Title"
}
~~~

### image
~~~json
{
  "type": "image",
  "title": "Product Screenshot",
  "imagePath": "/absolute/path/to/image.png",
  "caption": "Optional caption"
}
~~~

### team
~~~json
{
  "type": "team",
  "title": "Our Team",
  "members": [
    {
      "name": "Jane Doe",
      "role": "CEO",
      "bio": "Optional short bio",
      "photoPath": "/absolute/path/to/photo.png"
    }
  ]
}
~~~

### cta
~~~json
{
  "type": "cta",
  "title": "Let's Build Together",
  "subtitle": "email@company.com",
  "contact": "website.com • github.com/org"
}
~~~

## Theme Customization

Pass an optional theme object to customize colors:

~~~json
{
  "primaryColor": "#2563eb",
  "secondaryColor": "#7c3aed",
  "accentColor": "#f59e0b",
  "textColor": "#1f2937",
  "textLight": "#6b7280",
  "background": "#ffffff",
  "backgroundAlt": "#f9fafb",
  "fontFamily": "Helvetica"
}
~~~

All theme fields are optional — defaults are used for any omitted fields.

## Example: Calling generatePresentation

~~~json
{
  "slides": [
    {
      "type": "title",
      "title": "Acme Corp",
      "subtitle": "Revolutionizing Widget Manufacturing",
      "presenter": "Jane Doe • Series A • 2025"
    },
    {
      "type": "content",
      "title": "The Problem",
      "items": [
        "Widget production is slow and expensive",
        "Legacy systems can't keep up with demand",
        "Quality control remains manual"
      ]
    },
    {
      "type": "stats",
      "title": "Traction",
      "stats": [
        { "value": "500+", "label": "Customers" },
        { "value": "$2M", "label": "ARR" },
        { "value": "3x", "label": "YoY Growth" }
      ]
    },
    {
      "type": "cta",
      "title": "Let's Talk",
      "subtitle": "jane@acme.com",
      "contact": "acme.com"
    }
  ],
  "theme": {
    "primaryColor": "#2563eb"
  },
  "outputPath": "/Users/user/Desktop/acme_pitch.pdf"
}
~~~

## Pitch Deck Templates

### Series A Pitch Deck (12 slides)

Standard flow for investor presentations:

1. **Title** (type: title) - Company name, tagline, presenter
2. **Problem** (type: content) - What pain point you solve
3. **Solution** (type: content) - Your product/service
4. **Product** (type: image) - Demo/screenshots
5. **Market** (type: stats) - TAM/SAM/SOM
6. **Business Model** (type: content) - How you make money
7. **Traction** (type: stats) - Metrics and growth
8. **Competition** (type: two-column) - Your differentiation
9. **Team** (type: team) - Key team members
10. **Financials** (type: content or stats) - Projections
11. **The Ask** (type: content) - Funding amount and use
12. **Contact** (type: cta) - CTA with contact info

### Product Demo Deck (8 slides)

1. **Title** - Product name and tagline
2. **Problem** - User pain points
3. **Solution** - High-level approach
4. **Features** - Key capabilities (two-column)
5. **Demo** - Screenshots (image)
6. **Pricing** - Plans and pricing
7. **Testimonials** - Customer quotes (quote)
8. **Get Started** - CTA

## Content Limits Per Slide (IMPORTANT)

Each slide is a fixed 1280x720 page. Content that exceeds the available space will be clipped. Follow these limits strictly:

| Slide Type | Max Items / Content |
|------------|-------------------|
| content | 5 bullet points max (keep each bullet to 1 line, ~80 chars). If using paragraph text instead, max ~4 lines. |
| two-column | 4 bullet points per column max. Keep bullets short (~60 chars). |
| stats | 3-4 stats max. Keep labels short (1-2 words). |
| team | 4 members max per slide. Split into multiple team slides if needed. |
| quote | Keep quotes under ~200 characters. |
| image | Caption should be 1 line. |

**If the user's content needs more space**, split it across multiple slides of the same type rather than cramming it into one. For example, if there are 8 bullet points, use two content slides (4 each) with titles like "Key Benefits (1/2)" and "Key Benefits (2/2)".

## Best Practices

1. **Keep slides simple** - One idea per slide
2. **Use stats slides for numbers** - Big, bold metrics
3. **Limit bullet points** - 3-5 max per slide, keep them short
4. **Use two-column for comparisons** - Us vs. them, before/after
5. **End with clear CTA** - What do you want them to do?
6. **Gather knowledge first** - Check ~/.rowboat/knowledge/ before generating
7. **Use absolute paths** for images (PNG, JPG supported)
8. **Never overflow** - If content doesn't fit, split across multiple slides

## Output

The generatePresentation tool produces:
- **PDF file** at the specified outputPath
- **16:9 aspect ratio** (1280x720px per slide)
- **Print-ready** quality
- **Embedded fonts** for portability
`;

export default skill;
