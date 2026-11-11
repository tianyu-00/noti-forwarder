# Deploy

Images are built by CI and published to GHCR. The Ubuntu server only pulls them.

## One-time server setup
1. Create `~/notiforwarder/` and copy `docker-compose.yml` and `.env.example` (as `.env`) into it.
2. If the GHCR packages are private: `docker login ghcr.io` with a token that has `read:packages`.
3. Create a deploy-only SSH key, add the public half to the server user's `authorized_keys`.

## GitHub repo secrets
- `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` for the deploy workflow.
- `RELEASE_PLEASE_TOKEN`: a PAT so release tags trigger the CI image build.

## Deploying
Run the **deploy** workflow (Actions tab) with an explicit tag: a release (`1.2.3`),
a short SHA, or a branch tag. It sets `VERSION` in `.env`, then runs
`docker compose pull && docker compose up -d`. Roll back by running it with the old tag.
Pushes never change production by themselves.

## Architecture
CI builds `linux/amd64` and `linux/arm64`. Narrow to the host's architecture once
confirmed with `uname -m` on the server.
