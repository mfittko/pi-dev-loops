# pi-dev-loops containerized dev-loop runtime
# Single-stage deterministic build for local and CI use.

FROM node:24-bookworm-slim

# Pinned tool versions (bump together when updating)
ARG PI_VERSION=0.79.0
ARG PI_SUBAGENTS_VERSION=0.28.0
ARG PI_TELEGRAM_VERSION=0.3.5
ARG PI_INTERCOM_VERSION=0.6.0
ARG GH_CLI_VERSION=2.63.2

# System dependencies: git (dev-loop worktree ops), curl + ca-certificates (gh CLI install)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install pi CLI and extensions globally (pinned versions)
RUN npm install -g --ignore-scripts \
    "@earendil-works/pi-coding-agent@${PI_VERSION}" \
    "pi-subagents@${PI_SUBAGENTS_VERSION}" \
    "pi-telegram@${PI_TELEGRAM_VERSION}" \
    "pi-intercom@${PI_INTERCOM_VERSION}"

# Install GitHub CLI (pinned version, architecture-aware)
RUN ARCH=$(uname -m | sed 's/aarch64/arm64/; s/x86_64/amd64/') \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_${ARCH}.deb" -o /tmp/gh.deb \
    && dpkg -i /tmp/gh.deb \
    && rm /tmp/gh.deb

# Set workspace directory
WORKDIR /workspace

# Copy workspace files
COPY . .

# Install workspace dependencies (postinstall creates dev-loops symlink)
RUN npm ci

# Append workspace node_modules/.bin last so global tools take precedence
ENV PATH="${PATH}:/workspace/node_modules/.bin"

CMD ["dev-loops"]
