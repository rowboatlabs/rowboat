# Using RAG in Rowboat

Rowboat provides multiple ways to enhance your agents with Retrieval-Augmented Generation (RAG). This guide will help you set up and use each RAG feature.

## Quick Start

Text RAG and local file uploads are enabled by default - no configuration needed! Just start using them right away.

## Available RAG Features

### 1. Text RAG
✅ Enabled by default:

- Process and reason over text content directly
- No configuration required

### 2. Local File Uploads
✅ Enabled by default:

- Upload PDF files directly from your device
- Files are stored locally
- No configuration required
- Files are parsed using OpenAI by default

### 3. S3 File Uploads
To enable S3 file uploads, set the following variables:

```bash
# Enable S3 uploads
USE_RAG_S3_UPLOADS=true

# S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
RAG_UPLOADS_S3_BUCKET=your_bucket_name
RAG_UPLOADS_S3_REGION=your_region
```

### 4. URL Scraping
To enable URL scraping, set the following variables:

```bash
# Enable URL scraping
USE_RAG_SCRAPING=true

# Firecrawl API key for web scraping
FIRECRAWL_API_KEY=your_firecrawl_api_key
```

## File Parsing Options

### Default Parsing (OpenAI)
By default, uploaded PDF files are parsed using `gpt-4o`. You can customize this by setting the following:

```bash
# Override the default parsing model
FILE_PARSING_MODEL=your-preferred-model
```

You can also change the model provider like so:
```bash
# Optional: Override the parsing provider settings
FILE_PARSING_PROVIDER_BASE_URL=your-provider-base-url
FILE_PARSING_PROVIDER_API_KEY=your-provider-api-key
```

### Using Gemini for File Parsing
To use Google's Gemini model for parsing uploaded PDFs, set the following variable:

```bash
# Enable Gemini for file parsing
USE_GEMINI_FILE_PARSING=true
GOOGLE_API_KEY=your_google_api_key
```

## Embedding Model options

By default, Rowboat uses OpenAI's `text-embedding-3-small` model for generating embeddings. You can customize this by setting the following:

```bash
# Override the default embedding model
EMBEDDING_MODEL=your-preferred-model
```

You can also change the model provider like so:
```bash
# Optional: Override the embedding provider settings
EMBEDDING_PROVIDER_BASE_URL=your-provider-base-url
EMBEDDING_PROVIDER_API_KEY=your-provider-api-key
```

If you don't specify the provider settings, Rowboat will use OpenAI as the default provider.