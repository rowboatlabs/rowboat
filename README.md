# RowBoat
[![RowBoat Logo](/assets/rb-logo.png)](https://www.rowboatlabs.com/)

A Cursor-like, AI-assisted, no-code IDE for building production-ready multi-agents. Start from a simple prompt to create fully functional agents with the Copilot; test them in AI-simulated scenarios; connect MCP servers and tools; interact through the Python SDK, a web widget, or a Twilio phone number; and continuously refine your agents by providing feedback to the Copilot.

Built on OpenAI's Agents SDK, RowBoat is the fastest way to build multi-agents.

## Prerequisites

Before running RowBoat, ensure you have:

1. **Docker Desktop**
   - [Download Docker Desktop](https://www.docker.com/products/docker-desktop)

2. **OpenAI API Key**
   - Obtain from your OpenAI account.

3. **MongoDB**
   - macOS (Homebrew)
     ```bash
     brew tap mongodb/brew
     brew install mongodb-community@8.0
     brew services start mongodb-community@8.0
     ```
   - Other platforms: Refer to the MongoDB documentation for details.

## Quickstart

1. **Clone the Repository**
   ```bash
   git clone git@github.com:rowboatlabs/rowboat.git
   cd rowboat
   ```

2. **Environment Configuration**
   - Copy the `.env.example` file and rename it to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open the new .env file and update the OPENAI_API_KEY:

     ```ini
     # OpenAI Configuration
     OPENAI_API_KEY=your-openai-api-key
     ```

3. **Start the App**
   ```bash
   docker-compose up --build
   ```

4. **Access the App**
   - Visit [http://localhost:3000](http://localhost:3000).

## Enable RAG

RowBoat supports RAG capabilities to enhance responses with your custom knowledge base. To enable RAG, you'll need:

1. **Qdrant Vector Database**
   - **Option 1**: Use [Qdrant Cloud](https://cloud.qdrant.io/)
     - Create an account and cluster
     - Note your cluster URL and API key
   - **Option 2**: Run Qdrant locally with Docker:
     ```bash
     docker run -p 6333:6333 qdrant/qdrant
     ```

2. **Update Environment Variables**
   ```ini
   USE_RAG=true
   QDRANT_URL=<your-qdrant-url>  # e.g., http://localhost:6333 for local
   QDRANT_API_KEY=<your-api-key>  # Only needed for Qdrant Cloud
   ```

3. **Initialize Qdrant Collections**
   ```bash
   docker compose --profile setup_qdrant up setup_qdrant
   ```

   If you need to delete the collections and start fresh, you can run:
   ```bash
   docker compose --profile delete_qdrant up delete_qdrant
   ```

### RAG Features

RowBoat supports two types of knowledge base ingestion:

#### URL Scraping

Enable web page scraping to build your knowledge base:

1. **Get Firecrawl API Key**
   - Sign up at [Firecrawl](https://firecrawl.co)
   - Generate an API key

2. **Update Environment Variables**
   ```ini
   USE_RAG_SCRAPING=true
   FIRECRAWL_API_KEY=<your-firecrawl-api-key>
   ```

3. **Start the URLs Worker**
   ```bash
   docker compose --profile rag_urls_worker up -d
   ```

#### File Uploads

Enable file upload support (PDF, DOCX, TXT) for your knowledge base:

1. **Prerequisites**
   - An AWS S3 bucket for file storage
   - Google Cloud API key with Generative Language (Gemini) API enabled (for enhanced document parsing)

2. **Configure AWS S3**
   - Create an S3 bucket
   - Add the following CORS configuration to your bucket:
     ```json
     [
         {
             "AllowedHeaders": [
                 "*"
             ],
             "AllowedMethods": [
                 "PUT",
                 "POST",
                 "DELETE",
                 "GET"
             ],
             "AllowedOrigins": [
                 "http://localhost:3000",
             ],
             "ExposeHeaders": [
                 "ETag"
             ]
         }
     ]
     ```
   - Ensure your AWS credentials have the following IAM policy:
     ```json
     {
         "Version": "2012-10-17",
         "Statement": [
             {
                 "Sid": "VisualEditor0",
                 "Effect": "Allow",
                 "Action": [
                     "s3:PutObject",
                     "s3:GetObject",
                     "s3:DeleteObject",
                     "s3:ListBucket"
                 ],
                 "Resource": [
                     "arn:aws:s3:::<your-bucket-name>/*",
                     "arn:aws:s3:::<your-bucket-name>"
                 ]
             }
         ]
     }
     ```

3. **Update Environment Variables**
   ```ini
   USE_RAG_UPLOADS=true
   AWS_ACCESS_KEY_ID=<your-aws-access-key>
   AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
   RAG_UPLOADS_S3_BUCKET=<your-s3-bucket-name>
   RAG_UPLOADS_S3_REGION=<your-s3-region>
   GOOGLE_API_KEY=<your-google-api-key>
   ```

4. **Start the Files Worker**
   ```bash
   docker compose --profile rag_files_worker up -d
   ```

After enabling RAG and starting the required workers, you can manage your knowledge base through the RowBoat UI at `/projects/<PROJECT_ID>/sources`.

## Enable Tools Webhook

RowBoat includes a built-in webhook service that allows you to implement custom tool functions. To use this feature:

1. **Generate Signing Secret**
   Generate a secret for securing webhook requests:
   ```bash
   openssl rand -hex 32
   ```

2. **Update Environment Variables**
   ```ini
   SIGNING_SECRET=<your-generated-secret>
   ```

3. **Implement Your Functions**
   Add your custom functions to `apps/tools_webhook/function_map.py`:
   ```python
   def get_weather(location: str, units: str = "metric"):
       """Return weather data for the given location."""
       # Your implementation here
       return {"temperature": 20, "conditions": "sunny"}

   def check_inventory(product_id: str):
       """Check inventory levels for a product."""
       # Your implementation here
       return {"in_stock": 42, "warehouse": "NYC"}

   # Add your functions to the map
   FUNCTIONS_MAP = {
       "get_weather": get_weather,
       "check_inventory": check_inventory
   }
   ```

4. **Start the Tools Webhook Service**
   ```bash
   docker compose --profile tools_webhook up -d
   ```

5. **Register Tools in RowBoat**
   - Navigate to your project config at `/projects/<PROJECT_ID>/config`
   - Ensure that the webhook URL is set to: `http://tools_webhook:3005/tool_call`
   - Tools will automatically be forwarded to your webhook implementation

The webhook service handles all the security and parameter validation, allowing you to focus on implementing your tool logic.

## Enable Chat Widget

RowBoat provides an embeddable chat widget that you can add to any website. To enable and use the chat widget:

1. **Generate JWT Secret**
   Generate a secret for securing chat widget sessions:
   ```bash
   openssl rand -hex 32
   ```

2. **Update Environment Variables**
   ```ini
   USE_CHAT_WIDGET=true
   CHAT_WIDGET_SESSION_JWT_SECRET=<your-generated-secret>
   ```

3. **Start the Chat Widget Service**
   ```bash
   docker compose --profile chat_widget up -d
   ```

4. **Add Widget to Your Website**
   You can find the chat-widget embed code under `/projects/<PROJECT_ID>/config`

After setup, the chat widget will appear on your website and connect to your RowBoat project.

## Enable Authentication

By default, RowBoat runs without authentication. To enable user authentication using Auth0:

1. **Auth0 Setup**
   - **Create an Auth0 Account**: Sign up at [Auth0](https://auth0.com).
   - **Create a New Application**: Choose "Regular Web Application", select "Next.js" as the application type, and name it "RowBoat".
   - **Configure Application**:
     - **Allowed Callback URLs**: In the Auth0 Dashboard, go to your "RowBoat" application settings and set `http://localhost:3000/api/auth/callback` as an Allowed Callback URL.
   - **Get Credentials**: Collect the following from your Auth0 application settings:
     - **Domain**: Copy your Auth0 domain (ensure you append `https://` to the Domain that the Auth0 dashboard shows you)
     - **Client ID**: Your application's unique identifier
     - **Client Secret**: Your application's secret key
   - **Generate secret**: Generate a session encryption secret in your terminal and note the output for later:
     ```bash
     openssl rand -hex 32
     ```

2. **Update Environment Variables**
   Add the following to your `.env` file:
   ```ini
   USE_AUTH=true
   AUTH0_SECRET=your-generated-secret               # Generated using openssl command
   AUTH0_BASE_URL=http://localhost:3000             # Your application's base URL
   AUTH0_ISSUER_BASE_URL=https://example.auth0.com  # Your Auth0 domain (ensure it is prefixed with https://)
   AUTH0_CLIENT_ID=your-client-id
   AUTH0_CLIENT_SECRET=your-client-secret
   ```
   
After enabling authentication, users will need to sign in to access the application.

## Interact with RowBoat API

There are two ways to interact with RowBoat's API:

1. **Option 1: Python SDK**


   For Python applications, we provide an official SDK for easier integration:
   ```bash
   pip install rowboat
   ```

   ```python
   from rowboat import Client

   client = Client(
       host="http://localhost:3000",
       project_id="<PROJECT_ID>",
       api_key="<API_KEY>"  # Generate this from /projects/<PROJECT_ID>/config
   )

   # Simple chat interaction
   messages = [{"role": "user", "content": "Tell me the weather in London"}]
   response_messages, state = client.chat(messages=messages)
   ```

   For more details, see the [Python SDK documentation](./apps/python-sdk/README.md).

1. **Option 2: HTTP API**
   You can use the API directly at [http://localhost:3000/api/v1/](http://localhost:3000/api/v1/)
   - Project ID is available in the URL of the project page
   - API Key can be generated from the project config page at `/projects/<PROJECT_ID>/config`

   ```bash
   curl --location 'http://localhost:3000/api/v1/<PROJECT_ID>/chat' \
   --header 'Content-Type: application/json' \
   --header 'Authorization: Bearer <API_KEY>' \
   --data '{
       "messages": [
           {
               "role": "user",
               "content": "tell me the weather in london in metric units"
           }
       ]
   }'
   ```
   which gives:
   ```json
   {
       "messages": [
           {
               "role": "assistant",
               "tool_calls": [
                   {
                       "function": {
                           "arguments": "{\"location\":\"London\",\"units\":\"metric\"}",
                           "name": "weather_lookup_tool"
                       },
                       "id": "call_r6XKuVxmGRogofkyFZIacdL0",
                       "type": "function"
                   }
               ],
               "agenticSender": "Example Agent",
               "agenticResponseType": "internal"
           }
       ],
       "state": {
           // .. state data
       }
   }
   ```

## Troubleshooting

1. **MongoDB Connection Issues**
   - Ensure local MongoDB service is running: `brew services list`
   - Verify connection string and network connectivity.

2. **Container Start-up Issues**
   - Remove all containers: `docker-compose down`
   - Rebuild: `docker-compose up --build`

3. **Sign-in Button Not Appearing**
   - If the sign-in button does not appear in the UI, ensure the Auth0 domain in your `.env` file is prefixed with `https://`.

## Attribution
Our agents framework is built on top of [OpenAI Swarm](https://github.com/openai/swarm) with custom enhancements and improvements. Check the [NOTICE](https://github.com/rowboatlabs/rowboat/blob/main/apps/agents/NOTICE.md) for attribution and license.
