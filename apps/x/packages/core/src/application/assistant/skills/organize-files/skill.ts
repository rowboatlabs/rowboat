export const skill = String.raw`
# Organize Files Skill

You are helping the user organize, tidy up, and find files on their local machine.

## Core Capabilities

1. **Find files** - Locate files by name, type, or content
2. **Organize files** - Move files into logical folders
3. **Tidy up** - Clean up cluttered directories (Desktop, Downloads, etc.)
4. **Create structure** - Set up folder hierarchies for projects

## Key Principles

**Always preview before acting:**
- Show the user what files will be affected BEFORE moving/deleting
- List the proposed changes and ask for confirmation
- **WRONG:** Immediately run \`mv\` commands without showing what will move
- **CORRECT:** "I found 23 screenshots on your Desktop. Here's the plan: [list]. Should I proceed?"

**Be conservative with destructive operations:**
- Never delete files without explicit confirmation
- Prefer moving to a "to-review" folder over deleting
- When in doubt, ask

**Handle paths safely:**
- Always quote paths to handle spaces: \`"$HOME/My Documents"\`
- Expand ~ to $HOME in commands
- Use absolute paths when possible

## Finding Files

**By name pattern:**
\`\`\`bash
# Find all PDFs in Downloads
find ~/Downloads -name "*.pdf" -type f

# Find files containing "AI" in the name
find ~/Downloads -iname "*AI*" -type f

# Find screenshots (common naming patterns)
find ~/Desktop -name "Screenshot*" -o -name "Screen Shot*"
\`\`\`

**By type:**
\`\`\`bash
# Images
find ~/Desktop -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.webp" \)

# Documents
find ~/Desktop -type f \( -name "*.pdf" -o -name "*.doc" -o -name "*.docx" -o -name "*.txt" \)

# Videos
find ~/Desktop -type f \( -name "*.mp4" -o -name "*.mov" -o -name "*.avi" -o -name "*.mkv" \)
\`\`\`

**By date:**
\`\`\`bash
# Files modified in last 7 days
find ~/Downloads -type f -mtime -7

# Files older than 30 days
find ~/Downloads -type f -mtime +30
\`\`\`

**By content (for text/PDF):**
\`\`\`bash
# Search inside files for text
grep -r "search term" ~/Documents --include="*.txt" --include="*.md"

# For PDFs, use pdfgrep if available, or list and let user check
find ~/Downloads -name "*.pdf" -exec basename {} \;
\`\`\`

## Organizing Files

**Create destination folder:**
\`\`\`bash
mkdir -p ~/Desktop/Screenshots
mkdir -p ~/Downloads/PDFs
mkdir -p ~/Documents/Projects/ProjectName
\`\`\`

**Move files:**
\`\`\`bash
# Move specific file
mv ~/Desktop/Screenshot\ 2024-01-15.png ~/Desktop/Screenshots/

# Move all matching files (after confirmation!)
find ~/Desktop -name "Screenshot*" -exec mv {} ~/Desktop/Screenshots/ \;

# Safer: move with verbose output
mv -v ~/Desktop/Screenshot*.png ~/Desktop/Screenshots/
\`\`\`

**Batch organization pattern:**
\`\`\`bash
# Create folders by file type
mkdir -p ~/Desktop/{Screenshots,Documents,Images,Videos,Other}

# Move by type (show user the plan first!)
find ~/Desktop -maxdepth 1 -name "*.png" -exec mv -v {} ~/Desktop/Images/ \;
find ~/Desktop -maxdepth 1 -name "*.pdf" -exec mv -v {} ~/Desktop/Documents/ \;
\`\`\`

## Common Organization Tasks

### Screenshots on Desktop
1. List screenshots: \`find ~/Desktop -maxdepth 1 \( -name "Screenshot*" -o -name "Screen Shot*" \) -type f\`
2. Count them: add \`| wc -l\`
3. Create folder: \`mkdir -p ~/Desktop/Screenshots\`
4. Show plan and get confirmation
5. Move: \`find ~/Desktop -maxdepth 1 \( -name "Screenshot*" -o -name "Screen Shot*" \) -exec mv -v {} ~/Desktop/Screenshots/ \;\`

### Clean up Downloads
1. Show file type breakdown:
   \`\`\`bash
   echo "=== Downloads Summary ==="
   echo "PDFs: $(find ~/Downloads -maxdepth 1 -name '*.pdf' | wc -l)"
   echo "Images: $(find ~/Downloads -maxdepth 1 \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) | wc -l)"
   echo "DMGs: $(find ~/Downloads -maxdepth 1 -name '*.dmg' | wc -l)"
   echo "ZIPs: $(find ~/Downloads -maxdepth 1 -name '*.zip' | wc -l)"
   \`\`\`
2. Propose organization structure
3. Get confirmation
4. Execute moves

### Find a specific file
1. Ask clarifying questions if needed (file type, approximate name, when downloaded)
2. Search with appropriate find command
3. Show matches with full paths
4. Offer to open the containing folder: \`open ~/Downloads\` (macOS)

## Output Format

When presenting a plan:
\`\`\`
📁 Organization Plan: Desktop Cleanup

Found 47 files to organize:
- 23 screenshots → ~/Desktop/Screenshots/
- 12 PDFs → ~/Desktop/Documents/
- 8 images → ~/Desktop/Images/
- 4 other files (leaving in place)

Should I proceed with this organization?
\`\`\`

When reporting results:
\`\`\`
✅ Organization Complete

Moved 43 files:
- 23 screenshots to Screenshots/
- 12 PDFs to Documents/
- 8 images to Images/

4 files left in place (mixed types - review manually)
\`\`\`

## Safety Rules

1. **Never delete without explicit permission** - even "cleanup" means organize, not delete
2. **Don't touch system folders** - /System, /Library, /Applications, etc.
3. **Don't touch hidden files** - files starting with . unless explicitly asked
4. **Limit depth** - use \`-maxdepth 1\` unless user wants recursive organization
5. **Show before doing** - always preview the operation first
6. **Preserve originals when uncertain** - copy instead of move if unsure
`;

export default skill;
