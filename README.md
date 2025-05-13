![ui](/assets/banner.png)

<h2 align="center">Let AI build multi-agent workflows for you in minutes</h2>
<h5 align="center">

[Quickstart](#quick-start) | [Docs](https://docs.rowboatlabs.com/) | [Website](https://www.rowboatlabs.com/) |  [Discord](https://discord.gg/jHhUKkKHn8) 

</h5>

- ✨ **Start from an idea -> copilot builds your multi-agent workflows**
   - E.g. "Build me an assistant for a food delivery company to handle delivery status and missing items. Include the necessary tools."
- 🌐 **Connect MCP servers**
   - Add the MCP servers in settings -> import the tools into Rowboat.     
- 📞 **Integrate into your app using the HTTP API or Python SDK**
   - Grab the project ID and generated API key from settings and use the API.

Powered by OpenAI's Agents SDK, Rowboat is the fastest way to build multi-agents!

## Quick start
1. Set your OpenAI key
      ```bash
   export OPENAI_API_KEY=your-openai-api-key
   ```
      
2. Clone the repository and start Rowboat docker
   ```bash
   git clone git@github.com:rowboatlabs/rowboat.git
   cd rowboat
   docker-compose up --build
   ```

3. Access the app at [http://localhost:3000](http://localhost:3000).

## Demo

#### Create a multi-agent assistant with MCP tools by chatting with Rowboat
[![Screenshot 2025-04-23 at 00 25 31](https://github.com/user-attachments/assets/c8a41622-8e0e-459f-becb-767503489866)](https://youtu.be/YRTCw9UHRbU)

## Integrate with Rowboat agents

There are 2 ways to integrate with the agents you create in Rowboat

1. HTTP API
   - You can use the API directly at [http://localhost:3000/api/v1/](http://localhost:3000/api/v1/)
   - See [API Docs](https://docs.rowboatlabs.com/using_the_api/) for details
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
       ],
       "state": null
   }'
   ```
   

2. Python SDK
   You can use the included Python SDK to interact with the Agents
   ```
   pip install rowboat
   ```

   See [SDK Docs](https://docs.rowboatlabs.com/using_the_sdk/) for details. Here is a quick example:
   ```python
   from rowboat import Client, StatefulChat
   from rowboat.schema import UserMessage, SystemMessage

   # Initialize the client
   client = Client(
       host="http://localhost:3000",
       project_id="<PROJECT_ID>",
       api_key="<API_KEY>"
   )

   # Create a stateful chat session (recommended)
   chat = StatefulChat(client)
   response = chat.run("What's the weather in London?")
   print(response)

   # Or use the low-level client API
   messages = [
       SystemMessage(role='system', content="You are a helpful assistant"),
       UserMessage(role='user', content="Hello, how are you?")
   ]
   
   # Get response
   response = client.chat(messages=messages)
   print(response.messages[-1].content)
   ```


Refer to [Docs](https://docs.rowboatlabs.com/) to learn how to start building agents with Rowboat.

## Running on Kubernetes

### Prerequisites
- Kubernetes cluster (tested with k3s on Raspberry Pi)
- kubectl configured to access your cluster
- Docker registry access (for pushing images)
- SSH access to the target server (for deployment)

### Important Configuration Note
Before deploying, you must update the image names in the Kubernetes configuration files to use your own Docker Hub username and image names:

1. In `k8s/arm64/rowboat_agents-deployment.yaml`:
   - Change `stevef1uk/rowboat_agents:arm64` to `your-dockerhub-username/rowboat_agents:arm64`

2. In `k8s/arm64/rowboat-deployment.yaml`:
   - Change `stevef1uk/rowboat:arm64` to `your-dockerhub-username/rowboat:arm64`

3. In `k8s/arm64/copilot-deployment.yaml`:
   - Change `stevef1uk/copilot:arm64` to `your-dockerhub-username/copilot:arm64`

Replace `your-dockerhub-username` with your actual Docker Hub username. These changes ensure that Kubernetes pulls the correct images from your Docker Hub repository.

### Deployment Steps
1. Clone the repository
2. Update the following files with your specific configuration:
   - `k8s/app-config.yaml`: Update environment variables
   - `k8s/app-secrets.yaml`: Add your secrets (Auth0, OpenAI, etc.)
   - `k8s/openai-secret.yaml`: Add your OpenAI API key

3. Set up the OpenAI secret:
   ```bash
   # Generate base64-encoded API key
   echo -n "your-openai-api-key" | base64
   
   # Copy the output and replace the api-key value in k8s/openai-secret.yaml
   # The file should look like this:
   # apiVersion: v1
   # kind: Secret
   # metadata:
   #   name: openai-secret
   # type: Opaque
   # data:
   #   api-key: "YOUR_BASE64_ENCODED_API_KEY"
   ```

4. Apply the configurations in order:
   ```bash
   kubectl apply -f k8s/app-config.yaml
   kubectl apply -f k8s/app-secrets.yaml
   kubectl apply -f k8s/openai-secret.yaml
   ```

5. Deploy the applications:
   ```bash
   kubectl apply -f k8s/redis-deployment.yaml
   kubectl apply -f k8s/mongodb-deployment.yaml
   kubectl apply -f k8s/rowboat_agents-deployment.yaml
   kubectl apply -f k8s/copilot-deployment.yaml
   kubectl apply -f k8s/rowboat-deployment.yaml
   ```

6. Restart the deployments to ensure they pick up the new configurations:
   ```bash
   kubectl rollout restart deployment redis
   kubectl rollout restart deployment mongodb
   kubectl rollout restart deployment rowboat-agents
   kubectl rollout restart deployment copilot
   kubectl rollout restart deployment rowboat
   ```

### Accessing the Application

#### Option 1: Using Port Forwarding (Development/Testing)
To access the Rowboat UI using port forwarding:

```bash
# Forward port 3000 to access the Rowboat UI
kubectl port-forward svc/rowboat 3000:3000
```

Then access the application at http://localhost:3000

#### Option 2: Using Ingress (Production)
For production deployments, it's recommended to use an Ingress controller. Here's how to set it up:

1. Create an Ingress configuration file `k8s/ingress.yaml`:
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: Ingress
   metadata:
     name: rowboat-ingress
     annotations:
       nginx.ingress.kubernetes.io/rewrite-target: /
       nginx.ingress.kubernetes.io/ssl-redirect: "false"
   spec:
     rules:
     - host: rowboat.your-domain.com  # Replace with your domain
       http:
         paths:
         - path: /
           pathType: Prefix
           backend:
             service:
               name: rowboat
               port:
                 number: 3000
   ```

2. Apply the Ingress configuration:
   ```bash
   kubectl apply -f k8s/ingress.yaml
   ```

3. Configure your DNS to point to your cluster's Ingress controller IP address.

4. If using HTTPS (recommended for production):
   - Add SSL certificate configuration to the Ingress
   - Update the Auth0 configuration to use the HTTPS URL
   - Set `ssl-redirect: "true"` in the Ingress annotations

### Configuration

The application uses the following configuration files:
- `k8s/app-config.yaml`: Contains environment variables and service configurations
- `k8s/app-secrets.yaml`: Contains sensitive information like API keys and Auth0 configuration

### Troubleshooting

1. Check deployment status:
```bash
kubectl get deployments
kubectl get pods
```

2. View logs:
```bash
kubectl logs deployment/rowboat
kubectl logs deployment/rowboat-agents
kubectl logs deployment/copilot
```

3. Common issues:
- If services are not accessible, verify port forwarding is running or Ingress is configured correctly
- If MongoDB connection fails, check the connection string in `app-config.yaml`
- If Auth0 authentication fails, verify the configuration in `app-secrets.yaml`
- If using Ingress, check the Ingress controller logs:
  ```bash
  kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx
  ```

### Cleanup

To remove all Kubernetes resources:
```bash
kubectl delete -f k8s/
```

## CI/CD Configuration

The project uses Drone CI for continuous integration and deployment. The configuration is defined in `.drone.yml` and supports building and deploying to ARM64-based Kubernetes clusters.

### Required Secrets

The following secrets need to be configured in your Drone CI environment:

- `docker_username`: Your Docker Hub username
- `docker_password`: Your Docker Hub password
- `SSH_USER`: Username for SSH access to the target server
- `SSH_PASSWORD`: Password for SSH access to the target server

## Kubernetes Deployment

### API Key Configuration

When deploying to Kubernetes, ensure the following API keys are properly configured in `k8s/arm64/app-secrets.yaml`:

1. **CoPilot Service Authentication**
   - The `COPILOT_API_KEY` must be identical in both the Rowboat and CoPilot services
   - This key is used for internal service-to-service authentication
   - Example configuration:
     ```yaml
     COPILOT_API_KEY: "your-shared-api-key"  # Must be the same value in both services
     ```

2. **OpenAI Integration**
   - `OPENAI_API_KEY`: Your OpenAI API key for GPT model access
   - `PROVIDER_API_KEY`: Optional provider-specific API key if using a different LLM provider
   - `PROVIDER_BASE_URL`: Optional base URL for custom LLM provider

3. **Service-to-Service Communication**
   - `AGENTS_API_KEY`: API key for Rowboat Agents service authentication
   - Must be consistent across all services that need to communicate with the Agents service

### Common Issues

1. **403 Forbidden Errors**
   - If you see "Streaming failed" or 403 errors in the UI, check that:
     - `COPILOT_API_KEY` is identical in both Rowboat and CoPilot services
     - The API key is properly set in the Kubernetes secret
     - Both services have been restarted after updating the secret

2. **Service Connectivity**
   - Ensure all services can resolve each other using the Kubernetes service names:
     - Rowboat → CoPilot: `http://copilot:3002`
     - Rowboat → Agents: `http://rowboat-agents:3001`
     - Rowboat → MongoDB: `mongodb://admin:password@mongodb:27017/rowboat?authSource=admin`

### Updating Secrets

To update API keys or other secrets:

1. Edit `k8s/arm64/app-secrets.yaml`
2. Apply the changes:
   ```bash
   kubectl apply -f k8s/arm64/app-secrets.yaml
   ```
3. Restart the affected services:
   ```bash
   kubectl rollout restart deployment/copilot
   kubectl rollout restart deployment/rowboat
   ```
