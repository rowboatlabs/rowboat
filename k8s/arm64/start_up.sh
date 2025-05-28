kubectl apply -f app-config.yaml
kubectl apply -f app-secrets.yaml
kubectl apply -f openai-secret.yaml
kubectl apply -f copilot-deployment.yaml
#kubectl apply -f mongodb-vpc.yaml
#kubectl apply -f mongodb-deployment.yaml
kubectl apply -f redis-deployment.yaml
#kubectl apply -f rowboat-agents-go-deployment.yaml
kubectl apply -f rowboat-agents-deployment.yaml
sleep 4
kubectl apply -f rowboat-deployment.yaml
