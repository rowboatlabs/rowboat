# RowBoat Monorepo

This guide will help you set up and run the RowBoat applications locally using Docker.

## Prerequisites

Before running RowBoat, ensure you have:

1. **Docker Desktop**
   - [Download Docker Desktop](https://www.docker.com/products/docker-desktop)

2. **OpenAI API Key**
   - Obtain from your OpenAI account.

3. **MongoDB**
   - **Option 1**: Use an existing MongoDB deployment with your connection string.
   - **Option 2**: Install MongoDB locally:
     ```bash
     brew tap mongodb/brew
     brew install mongodb-community@8.0
     brew services start mongodb-community@8.0
     ```

4. **Auth0 Account and Application Setup**
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

## Local Development Setup

1. **Clone the Repository**
   ```bash
   git clone git@github.com:rowboatlabs/rowboat.git
   cd rowboat
   git checkout dev
   ```

2. **Environment Configuration**
   - Copy the `.env.example` file and rename it to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Update your `.env` file with the following configurations:

     ```ini
     # AI Model Configuration (choose one provider)
     # For OpenAI
     COPILOT_MODEL=openai/gpt-4o
     OPENAI_API_KEY=your-openai-api-key

     # For AWS Bedrock
     COPILOT_MODEL=aws/us.anthropic.claude-3-sonnet-20240229-v1:0
     AWS_ACCESS_KEY_ID=your-aws-access-key
     AWS_SECRET_ACCESS_KEY=your-aws-secret-key
     AWS_REGION=your-aws-region

     # Auth0 Configuration
     AUTH0_SECRET=your-generated-secret               # Generated using openssl command
     AUTH0_BASE_URL=http://localhost:3000             # Your application's base URL
     AUTH0_ISSUER_BASE_URL=https://example.auth0.com  # Your Auth0 domain (ensure it is prefixed with https://)
     AUTH0_CLIENT_ID=your-client-id
     AUTH0_CLIENT_SECRET=your-client-secret

     # MongoDB Configuration (choose one based on your setup)
     # For local MongoDB
     MONGODB_CONNECTION_STRING=mongodb://host.docker.internal:27017/rowboat 
     # or, for remote MongoDB
     MONGODB_CONNECTION_STRING=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/rowboat 
     ```

3. **Start the App**
   ```bash
   docker-compose up --build
   ```

4. **Access the App**
   - Visit [http://localhost:3000](http://localhost:3000).

5. **Interact with RowBoat**

   There are two ways to interact with RowBoat:

   ### Option 1: Python SDK

   For Python applications, we provide an official SDK for easier integration:
   ```bash
   pip install rowboat
   ```

   ```python
   from rowboat import Client

   client = Client(
       host="http://localhost:3000",
       project_id="<PROJECT_ID>",
       project_secret="<PROJECT_SECRET>"
   )

   # Simple chat interaction
   messages = [{"role": "user", "content": "Tell me the weather in London"}]
   response_messages, state = client.chat(messages=messages)
   ```

   For more details, see the [Python SDK documentation](./apps/python-sdk/README.md).

   ### Option 2: HTTP API

   You can use the API directly at [http://localhost:3000/api/v1/](http://localhost:3000/api/v1/)
   - Project ID is available in the URL of the project page
   - Project Secret is available in the project config page

   ```bash
   curl --location 'http://localhost:3000/api/v1/<PROJECT_ID>/chat' \
   --header 'Content-Type: application/json' \
   --header 'Authorization: Bearer <PROJECT_SECRET>' \
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
