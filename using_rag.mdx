# Using RAG in Rowboat

Rowboat provides multiple ways to enhance your agents' context with Retrieval-Augmented Generation (RAG). This guide will help you set up and use each RAG features.

## Quick Start

Text RAG and local file uploads are enabled by default - no configuration needed! Just start using them right away.

## RAG Features

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
- For larger files, we recommend using Gemini models - see section below.

#### 2.1 Using Gemini for File Parsing
To use Google's Gemini model for parsing uploaded PDFs, set the following variable:

```bash
# Enable Gemini for file parsing
export USE_GEMINI_FILE_PARSING=true
export GOOGLE_API_KEY=your_google_api_key
```

### 3. URL Scraping
Rowboat uses Firecrawl for URL scraping. To enable URL scraping, set the following variables:

```bash
export USE_RAG_SCRAPING=true
export FIRECRAWL_API_KEY=your_firecrawl_api_key
```

## Advanced RAG features

### 1. File Uploads Backed by S3
To enable S3 file uploads, set the following variables:

```bash
# Enable S3 uploads
export USE_RAG_S3_UPLOADS=true

# S3 Configuration
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export RAG_UPLOADS_S3_BUCKET=your_bucket_name
export RAG_UPLOADS_S3_REGION=your_region
```

### 2. Changing Default Parsing Model

By default, uploaded PDF files are parsed using `gpt-4o`. You can customize this by setting the following:

```bash
# Override the default parsing model
export FILE_PARSING_MODEL=your-preferred-model
```

You can also change the model provider like so:
```bash
# Optional: Override the parsing provider settings
export FILE_PARSING_PROVIDER_BASE_URL=your-provider-base-url
export FILE_PARSING_PROVIDER_API_KEY=your-provider-api-key
```

### 3. Embedding Model Options

By default, Rowboat uses OpenAI's `text-embedding-3-small` model for generating embeddings. You can customize this by setting the following:

```bash
# Override the default embedding model
export EMBEDDING_MODEL=your-preferred-model
export EMBEDDING_VECTOR_SIZE=1536
```

**Important NOTE**

The default size for the vectors index is 1536. If you change this value, then you must delete the index and set it up again:
```bash
docker-compose --profile delete_qdrant --profile qdrant up --build delete_qdrant qdrant
```
followed by:
```bash
./start # this will recreate the index
```

You can also change the model provider like so:
```bash
# Optional: Override the embedding provider settings
export EMBEDDING_PROVIDER_BASE_URL=your-provider-base-url
export EMBEDDING_PROVIDER_API_KEY=your-provider-api-key
```

If you don't specify the provider settings, Rowboat will use OpenAI as the default provider.
