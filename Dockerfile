# syntax=docker/dockerfile:1.7
###############################################
# Shopify Dev MCP Server Docker Image (Extended)
# Two run modes:
#  - STDIO (default for local MCP clients like Cursor / Claude)
#  - WEB  (adds lightweight HTTP health endpoint for platforms
#          that require a listening port, e.g. Render Web Service)
# Switch with RUN_MODE env var (stdio|web). Default: stdio
###############################################

ARG NODE_VERSION=20-alpine
FROM node:${NODE_VERSION} AS base

LABEL org.opencontainers.image.source="https://github.com/Shopify/dev-mcp" \
      org.opencontainers.image.description="Shopify Dev MCP Server" \
      org.opencontainers.image.licenses="ISC"

# Configure work dir & non‑root user
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
USER app

# Copy adapter (added later) if present during build context (will overwrite after install)

# Optional build args
# DEV_MCP_VERSION can be set to a specific semver (e.g. 0.1.3) for reproducibility
ARG DEV_MCP_VERSION=latest
ENV DEV_MCP_VERSION=${DEV_MCP_VERSION}

# Instrumentation / feature flags (override at runtime as needed)
# Set OPT_OUT_INSTRUMENTATION=true to disable usage telemetry (default here: enabled)
ENV OPT_OUT_INSTRUMENTATION=false \
    POLARIS_UNIFIED=false \
    NODE_ENV=production \
    RUN_MODE=stdio \
    PORT=8080

# Install the server globally (scoped package)
RUN npm install -g @shopify/dev-mcp@${DEV_MCP_VERSION} \
 && npm cache clean --force

# Copy adapter after install (added by repository)
COPY --chown=app:app adapter.js ./

# Expose port only for web mode (harmless if unused)
EXPOSE 8080

# Healthcheck: if in stdio mode, check process; if in web mode, hit local HTTP
HEALTHCHECK CMD if [ "$RUN_MODE" = "web" ]; then wget -qO- http://127.0.0.1:${PORT}/health || exit 1; else pgrep -f "@shopify/dev-mcp" > /dev/null || exit 1; fi

# Entrypoint script executed via node to allow mode switching
ENTRYPOINT ["node","/app/adapter.js"]

# -------- Usage Examples --------
# Build (pin a version):
#   docker build --build-arg DEV_MCP_VERSION=latest -t shopify-dev-mcp .
# Run STDIO (interactive):
#   docker run -it --rm shopify-dev-mcp
# Run WEB mode (health endpoint on :8080):
#   docker run -e RUN_MODE=web -p 8080:8080 shopify-dev-mcp
# Disable instrumentation & enable Polaris docs:
#   docker run -it -e OPT_OUT_INSTRUMENTATION=true -e POLARIS_UNIFIED=true shopify-dev-mcp
# Render example (service expects port):
#   (Set RUN_MODE=web and PORT env if different; Render auto-detects 8080)
###############################################
