/**
 * AT&T Shopping MCP Server - Entry Point
 *
 * Supports both Streamable HTTP transport (for web) and stdio (for Claude Desktop).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export declare function startStreamableHTTPServer(serverFactory: () => McpServer): Promise<void>;
/**
 * Starts an MCP server with stdio transport (for Claude Desktop).
 */
export declare function startStdioServer(serverFactory: () => McpServer): Promise<void>;
