#!/usr/bin/env node
/**
 * adapter.js
 * Run modes:
 *  - stdio: Launch @shopify/dev-mcp directly (default)
 *  - web:   Launch MCP server as a child process (stdio) and expose a tiny
 *           HTTP server for platforms requiring a listening port (health only).
 *
 * NOTE: MCP is a stdio protocol. The HTTP layer here does NOT proxy MCP;
 * it only provides a health/status endpoint and basic lifecycle signals.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';

const RUN_MODE = process.env.RUN_MODE || 'stdio';
const PORT = parseInt(process.env.PORT || '8080', 10);
const DEV_MCP_VERSION = process.env.DEV_MCP_VERSION || 'latest';

function launchMcp() {
  const child = spawn('npx', ['-y', `@shopify/dev-mcp@${DEV_MCP_VERSION}`], {
    stdio: RUN_MODE === 'stdio' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    console.error(`[adapter] MCP process exited code=${code} signal=${signal}`);
    if (RUN_MODE === 'stdio') {
      process.exit(code ?? 1);
    } else {
      // In web mode we keep container alive only if exit was clean? We'll exit.
      process.exit(code ?? 1);
    }
  });

  if (RUN_MODE === 'web') {
    child.stdout?.on('data', (d) => process.stderr.write(`[mcp-out] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[mcp-err] ${d}`));
  }

  return child;
}

if (RUN_MODE === 'stdio') {
  launchMcp();
} else if (RUN_MODE === 'web') {
  const child = launchMcp();
  let healthy = false;
  const startedAt = Date.now();

  // Consider process healthy after a short grace period
  setTimeout(() => { healthy = true; }, 1500);

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const status = healthy && child.exitCode == null ? 'ok' : 'starting';
      res.writeHead(status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status, uptimeSeconds: (Date.now() - startedAt) / 1000 }));
      return;
    }
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mode: RUN_MODE,
        mcpVersion: DEV_MCP_VERSION,
        pid: child.pid,
        exitCode: child.exitCode,
        startedAt,
      }));
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(PORT, () => {
    console.error(`[adapter] Web mode listening on :${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.error('[adapter] SIGTERM received, shutting down');
    child.kill('SIGTERM');
    server.close(() => process.exit(0));
  });
} else {
  console.error(`[adapter] Unknown RUN_MODE=${RUN_MODE}`);
  process.exit(1);
}
