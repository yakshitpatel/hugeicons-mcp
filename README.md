# hugeicons-mcp

An MCP server that gives AI assistants [Hugeicons](https://hugeicons.com) as SVG markup. With a Hugeicons Pro licence you get all 10 styles: stroke, solid and duotone in their variants, plus twotone and bulk. Without one you get the free stroke-rounded set. Each style has about 6,000 icons.

It runs on your machine. The icons come from the npm packages your licence installs, and the server renders them to SVG locally. The only network call is to `hugeicons.com/api/icons` for search tags, cached for 7 days. There is no telemetry.

The official [`@hugeicons/mcp-server`](https://github.com/hugeicons/hugeicons/tree/main/tools/mcp-server) does something different. It returns icon-font glyphs and setup docs, not SVG, and it has no Pro styles.

## Tools

| Tool | What it does |
| --- | --- |
| `search_icons` | Finds icons by name, tag or category, e.g. "delivery truck". |
| `get_icon` | Returns one icon as SVG in a chosen style, size, colour, secondary colour and stroke width. Can write it to an `.svg` file. |
| `compare_styles` | Returns one icon in every installed style, so you can pick one. |
| `list_styles` | Shows which styles are installed and how to add the rest. |

Names match the ones on hugeicons.com (`delivery-truck-01`, `1st-bracket`). Code names such as `DeliveryTruck01Icon` work too.

## Install

You need Node and pnpm. It is built and tested on Node 26.

```sh
git clone https://github.com/yakshitpatel/hugeicons-mcp.git
cd hugeicons-mcp
pnpm install
pnpm build
```

### Pro styles

Copy your Universal License Key from the Tokens tab of your Hugeicons account, add this line to `~/.npmrc`, then run `pnpm install` again:

```ini
//npm.hugeicons.com/:_authToken=YOUR_UNIVERSAL_LICENSE_KEY
```

The repo's own `.npmrc` already points `@hugeicons-pro` at the Hugeicons registry. Keep the key in your home folder so it never lands in git. Without a key, `pnpm install` skips the Pro packages and still succeeds.

## Connect it

Claude Code:

```sh
claude mcp add hugeicons -s user -- node /absolute/path/to/hugeicons-mcp/dist/index.js
```

Claude Desktop, Cursor and other clients take the same command in their MCP config:

```json
{
  "mcpServers": {
    "hugeicons": {
      "command": "node",
      "args": ["/absolute/path/to/hugeicons-mcp/dist/index.js"]
    }
  }
}
```

## Use it

Ask in plain words:

- "Find a Hugeicon for notifications and give me the duotone-rounded SVG in #0f172a with an orange secondary colour."
- "Show me the home icon in every style."
- "Save the solid-sharp settings icon to ~/Desktop/settings.svg at 48px."

To get an icon into Figma, ask for it with a `save_to` path and have your assistant upload that file with the Figma MCP.

Colours are hex (`#0f172a`), `rgb()`, `hsl()` or `oklch()` values, `currentColor` or `transparent`. Your assistant turns "orange" into a hex value.

`save_to` takes an absolute path or one starting with `~/`. It only writes regular files ending in `.svg`, refuses symbolic links, hard links and pipes, and won't replace an existing file unless you pass `overwrite: true`.

## Develop

```sh
pnpm build
pnpm test
```

`test/real-packages.test.mjs` parses and renders every icon in every installed style, about 60,000 files with Pro installed. It finishes in about 15 seconds.

## Licence

The code is MIT. The icons are not part of this repo: they belong to Hugeicons and are covered by your Hugeicons licence. Pro icons need a valid Pro licence. This project is not affiliated with Hugeicons.
