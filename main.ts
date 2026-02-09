/**
 * AT&T Shopping MCP Server - Entry Point
 * 
 * Supports both Streamable HTTP transport (for web) and stdio (for Claude Desktop).
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startStreamableHTTPServer(
  serverFactory: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "1.0.0", server: "AT&T Shopping MCP" });
  });

  // Info page
  app.get("/", (_req: Request, res: Response) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AT&T Shopping MCP Server</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background: linear-gradient(135deg, #0057b8 0%, #00a8e8 100%);
      min-height: 100vh;
    }
    .card {
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 { margin: 0 0 10px 0; color: #0057b8; }
    .status { color: #22c55e; font-weight: bold; font-size: 1.2em; }
    code { background: #f4f4f4; padding: 4px 8px; border-radius: 6px; font-size: 0.9em; }
    .feature-list { list-style: none; padding: 0; }
    .feature-list li { padding: 8px 0; border-bottom: 1px solid #eee; }
    .feature-list li:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🛒 AT&T Shopping MCP Server</h1>
    <p class="status">✅ Running with Interactive UI Apps</p>
    <p><strong>Version:</strong> 1.0.0 | <strong>Endpoint:</strong> <code>/mcp</code></p>
    
    <h3>🎯 Interactive UI Tools</h3>
    <ul class="feature-list">
      <li>📱 <strong>get_phones</strong> - Visual phone catalog with filters</li>
      <li>📋 <strong>get_wireless_plans</strong> - Plan comparison interface</li>
      <li>🛒 <strong>get_cart</strong> - Interactive shopping cart</li>
      <li>📊 <strong>get_inventory_summary</strong> - Inventory dashboard</li>
    </ul>
    
    <h3>🔧 Text Tools</h3>
    <ul class="feature-list">
      <li>🔍 search_products, get_internet_plans, get_promotions</li>
      <li>➕ add_to_cart, remove_from_cart, apply_promo</li>
      <li>💳 clear_cart, checkout</li>
      <li>📍 check_address (for internet qualification)</li>
    </ul>
    
    <h3>💰 Trade-In Tools (Live AT&T API)</h3>
    <ul class="feature-list">
      <li>📱 <strong>get_tradein_brands</strong> - List brands eligible for trade-in</li>
      <li>📋 <strong>get_tradein_models</strong> - Get models for a brand</li>
      <li>💵 <strong>get_tradein_value</strong> - Get trade-in price (by name or IMEI)</li>
      <li>🔍 <strong>search_tradein</strong> - Search trade-in devices</li>
      <li>🔑 <strong>validate_imei</strong> - Validate IMEI + auto trade-in lookup</li>
    </ul>
    
    <h3>🚀 Connect to Claude</h3>
    <p>Use <code>npx cloudflared tunnel --url http://localhost:${port}</code> to expose this server, then add as a custom connector in Claude.</p>
  </div>
</body>
</html>
    `);
  });

  // MCP endpoint
  app.all("/mcp", async (req: Request, res: Response) => {
    const server = serverFactory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log("=".repeat(60));
    console.log("  🛒 AT&T Shopping MCP Server");
    console.log("  Interactive UI Apps Edition");
    console.log("=".repeat(60));
    console.log(`  🌐 HTTP: http://localhost:${port}`);
    console.log(`  🔌 MCP:  http://localhost:${port}/mcp`);
    console.log("=".repeat(60));
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Starts an MCP server with stdio transport (for Claude Desktop).
 */
export async function startStdioServer(
  serverFactory: () => McpServer,
): Promise<void> {
  await serverFactory().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
