FROM oven/bun:1.3-alpine

WORKDIR /app

# Copy dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# MCP server connects to the production backend by default.
# Override BACKEND_URL for local testing.
ENV BACKEND_URL=https://poc-backend.amdal-dev.workers.dev

# Glama runs the container and communicates via stdio (MCP protocol).
# The server starts, connects via StdioServerTransport, and responds to
# MCP introspection requests.
CMD ["bun", "run", "src/mcp/server.ts"]
