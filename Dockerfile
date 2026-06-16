# Pinned Bun version for reproducible builds.
# 1.3-alpine is a moving tag — pinning to 1.3.13 avoids surprise patch drift
# from breaking Glama / smithery rebuilds we don't trigger ourselves.
FROM oven/bun:1.3.13-alpine

WORKDIR /app

# Install production deps from the committed lockfile.
# --frozen-lockfile makes the build deterministic (fails loudly on drift
# rather than silently resolving to a different transitive tree).
# --production skips devDependencies (@types/*), which are not needed at runtime —
# Bun runs .ts files natively without the TypeScript compiler.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# MCP server source.
COPY src/ ./src/
COPY tsconfig.json ./

# MCP server connects to the production backend by default.
# Override BACKEND_URL for local testing.
ENV BACKEND_URL=https://poc-backend.amdal-dev.workers.dev

# Glama runs the container and communicates via stdio (MCP protocol).
# The server starts, connects via StdioServerTransport, and responds to
# MCP introspection requests.
CMD ["bun", "src/mcp/server.ts"]
