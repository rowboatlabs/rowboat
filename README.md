# RowBoat Monorepo

This guide will help you set up and run the RowBoat applications locally using Docker.

## Prerequisites

Before running RowBoat, ensure you have:

1. **Docker Desktop**
   - [Download Docker Desktop](https://www.docker.com/products/docker-desktop) and ensure Docker Compose is included.

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
   - **Get Credentials**: Note down Domain, Client ID, and Client Secret.
   - **Secure Application**: Generate a session encryption secret in your terminal and note the output for later:
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
     # OpenAI Configuration
     OPENAI_API_KEY=your-openai-api-key

     # Auth0 Configuration
     AUTH0_SECRET=your-generated-secret               # Generated using openssl command
     AUTH0_BASE_URL=http://localhost:3000             # Your application's base URL
     AUTH0_ISSUER_BASE_URL=https://example.auth0.com  # Your Auth0 domain
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

## Troubleshooting

1. **MongoDB Connection Issues**
   - Ensure local MongoDB service is running: `brew services list`
   - Verify connection string and network connectivity.

2. **Container Start-up Issues**
   - Remove all containers: `docker-compose down`
   - Rebuild: `docker-compose up --build`
