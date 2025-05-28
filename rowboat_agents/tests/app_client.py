from src.utils.common import common_logger, read_json_from_file
logger = common_logger
logger.info("Running swarm_flask_client.py")
import requests

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample_request', type=str, required=True, help='Sample request JSON file name under tests/sample_requests/')
    parser.add_argument('--api_key', type=str, required=True, help='API key to use for authentication')
    parser.add_argument('--host', type=str, required=False, help='Host to use for the request', default='http://localhost:4040')
    args = parser.parse_args()

    request = read_json_from_file(f"./tests/sample_requests/{args.sample_request}").get("lastRequest", {})
    print("Sending request...")
    response = requests.post(
        f"{args.host}/chat",
        json=request,
        headers={'Authorization': f'Bearer {args.api_key}'}
    ).json()
    print("Output: ")
    print(response)