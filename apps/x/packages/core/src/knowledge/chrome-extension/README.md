# Page Capture Chrome Extension

A Chrome extension that captures web pages you visit and sends them to a local server for storage as markdown files.

## Structure

```
/extension
  manifest.json    # Chrome extension manifest (v3)
  background.js    # Service worker that captures pages
/server
  server.py        # Flask server for storing captures
  captured_pages/  # Directory where pages are saved
```

## Setup

### 1. Install Server Dependencies

```bash
cd server
pip install flask flask-cors
```

### 2. Start the Server

```bash
cd server
python server.py
```

The server will run at `http://localhost:3001`.

### 3. Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder

## Usage

Once both the server is running and the extension is installed, the extension will automatically capture pages as you browse:

- Every page load (http/https URLs only) triggers a capture
- Content is hashed with SHA-256 to avoid duplicate captures
- Pages are saved as markdown files with frontmatter metadata

## API Endpoints

### POST /capture

Receives captured page data.

**Request body:**
```json
{
  "url": "https://example.com",
  "content": "Page text content...",
  "timestamp": 1706123456789,
  "title": "Page Title"
}
```

**Response:**
```json
{"status": "captured", "filename": "1706123456789_example_com.md"}
```

### GET /status

Returns the count of captured pages.

**Response:**
```json
{"count": 42}
```

## File Format

Captured pages are saved as markdown with YAML frontmatter:

```markdown
---
url: https://example.com/page
title: Page Title
captured_at: 2024-01-24T12:34:56
---

Page content here...
```

## Debugging

- **Extension logs**: Open `chrome://extensions/`, find "Page Capture", click "Service worker" to view console logs
- **Server logs**: Check the terminal where `server.py` is running
