# Running rowboat-server on a remote machine

Phase 8 of SEPARATION_PLAN.md: core runs on a remote box, the desktop app is a
pure client. This documents the validated path — Tailscale for networking (no
public exposure, no TLS certs), Ubuntu on EC2 as the host.

## 1. Provision the box

- EC2: Ubuntu 24.04 LTS, t3.medium (2 vCPU / 4 GB), 20 GB gp3.
- Security group: **SSH (22) from your IP only. Nothing else.** All app
  traffic rides the tailnet, so the server is never exposed publicly — this is
  what makes `lanEnabled` (a 0.0.0.0 bind) safe below.
- On the box:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                      # sign in with the same account as your Mac
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
tailscale ip -4                        # note the 100.x.y.z address
```

- On your Mac: install Tailscale (tailscale.com/download), sign in with the
  same account. `ping <100.x.y.z>` should answer.

## 2. Build and ship the server

On your dev machine, from `apps/x`:

```sh
npm run deps                            # shared → core → server → client
cd apps/server && npm run build:headless
tar -C dist-headless -czf rowboat-server.tgz .
scp -i <key.pem> rowboat-server.tgz ubuntu@<public-ip>:
```

On the box:

```sh
mkdir -p ~/rowboat-server && tar -xzf rowboat-server.tgz -C ~/rowboat-server
cd ~/rowboat-server && npm install --omit=dev     # compiles node-pty for this host
mkdir -p ~/.rowboat/config
echo '{"lanEnabled": true}' > ~/.rowboat/config/server.json
node rowboat-server.cjs
```

First boot creates `~/.rowboat` and mints the auth token at
`~/.rowboat/server-key`. Copy it:

```sh
cat ~/.rowboat/server-key
```

For an unattended server, run it under systemd:

```ini
# /etc/systemd/system/rowboat-server.service
[Unit]
Description=rowboat-server
After=network-online.target tailscaled.service

[Service]
User=ubuntu
ExecStart=/usr/bin/node /home/ubuntu/rowboat-server/rowboat-server.cjs
Restart=always

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now rowboat-server`

## 3. Point the desktop app at it

```sh
ROWBOAT_REMOTE_SERVER=http://<100.x.y.z>:3220 \
ROWBOAT_REMOTE_TOKEN=<contents of server-key> \
npm run dev          # or open the packaged app with these env vars set
```

In remote mode main spawns no child server and runs no core: RPC calls,
the WS event feed, workspace file serving (`app://workspace/...`), and
reverse-call capabilities (notifications, open-url, browser control…) all
target the remote box. Notes, sessions, connectors, and the terminal show
the **server machine's** state — that is the point.

The phone pairs directly with the server the same way (it just needs
Tailscale, or `lanEnabled` on a shared LAN).

## Configuring the server

LLM provider keys live server-side: `~/.rowboat/config/models.json` on the
box (same schema as the desktop writes). Easiest bootstrap: copy your local
`~/.rowboat/config/models.json` to the box once — or edit models in the
desktop settings UI while connected remotely; the writes land on the server.

## Known gaps (Phase 8b)

- **Token encryption at rest**: headless has no OS keychain — connector
  tokens fall back to plaintext files in `~/.rowboat`. Mitigate with disk
  encryption + locked-down box until the file-key cipher lands.
- **OAuth connect flows**: the loopback redirect lands on the *server's*
  localhost. Connecting a new provider remotely needs the claim flow (8b);
  until then, connect providers while running locally, or complete the OAuth
  redirect in a browser on the server (e.g. via SSH port-forward:
  `ssh -L <port>:127.0.0.1:<port>` during the flow).
- **Security model**: bearer token over plain HTTP inside the tailnet.
  Tailscale encrypts on the wire (WireGuard); do not run this over untrusted
  networks without it (or a TLS reverse proxy).
