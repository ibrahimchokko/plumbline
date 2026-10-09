# The `plumb` CLI in a container (used by docker-compose for simulated verifiers).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY cli/package.json cli/
COPY web/package.json web/
RUN npm install --no-audit --no-fund --workspace cli --include-workspace-root=false
COPY packages/core packages/core
COPY cli cli
ENTRYPOINT ["node", "cli/bin/plumb.mjs"]
