# Solispec MCP server

An [MCP](https://modelcontextprotocol.io) server for [Solispec](https://solispec.com), the browser app for solar installers: mounting frame design, snow and wind load checks, bill of materials, calculation reports and client proposals.

It lets an AI assistant (Claude, Cursor, VS Code and other MCP clients) work with your Solispec organization through the public [Solispec API](https://solispec.com/v1/openapi.json): list and update projects, read the calculation report of a version, create a commercial proposal, manage clients and your price list.

> The API is part of the Solispec **Business** plan. Create a key in the cabinet: [solispec.com/app/api](https://solispec.com/app/api). A *read* key can only read; a *write* key acts as a member of the organization.

## Tools

| Read | Write |
|---|---|
| `whoami` the organization and the key | `create_project`, `update_project` |
| `list_projects`, `get_project` | `save_version` freeze the draft as a version (recalculated on the server) |
| `get_version` snapshot and calculation summary | `queue_report_pdf`, `queue_offer_pdf` |
| `get_report` the calculation report (loads, checks, bill of materials) as text | `create_offer`, `send_offer`, `revoke_offer` |
| `list_offers`, `get_offer` | `request_review` engineer review |
| `list_clients`, `get_client` | `create_client`, `update_client` |
| `list_reviews`, `get_document` | `update_prices`, `adjust_prices` (dry run by default) |
| `get_prices` | |

Set `SOLISPEC_READ_ONLY=1` to expose the read tools only.

## Install

Requires Node.js 20 or newer.

### Claude Code

```bash
claude mcp add solispec --env SOLISPEC_API_KEY=sol_... -- npx -y github:solispec/solispec-mcp
```

### Claude Desktop, Cursor, VS Code and other clients

```json
{
  "mcpServers": {
    "solispec": {
      "command": "npx",
      "args": ["-y", "github:solispec/solispec-mcp"],
      "env": { "SOLISPEC_API_KEY": "sol_..." }
    }
  }
}
```

### Environment

| Variable | Default | |
|---|---|---|
| `SOLISPEC_API_KEY` | (required) | organization API key, `sol_` + 40 characters |
| `SOLISPEC_READ_ONLY` | off | `1` hides the write tools |
| `SOLISPEC_BASE_URL` | `https://solispec.com` | |

## Examples

- "List my projects in status offer and summarize the loads of each."
- "Open version 2 of the Kraków project and tell me which structural check is closest to its limit."
- "Create a proposal from version 3 with three options, valid 14 days, for client Anna Weber."
- "Raise all fastener prices by 5 %, show me the changes first."

## Notes

- The calculation itself runs on the Solispec server; this package is a thin API client and contains no engineering code.
- Results are a design aid. Loads and structural checks must be verified by a qualified engineer for the actual site.
- Free calculators (snow and wind loads, string sizing, ballast, battery backup, tilt and row spacing) are on [solispec.com](https://solispec.com/en/calculators) and need no key.

## License

MIT
