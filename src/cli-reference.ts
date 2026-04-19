/**
 * Single source of truth for CLI help (console) and README injection (see scripts/sync-readme-cli.mts).
 */

export interface CliGlobalFlag {
  flag: string;
  description: string;
}

export interface CliCommand {
  /** One-line usage */
  usage: string;
  /** Short purpose */
  summary: string;
  /** Extra notes (markdown bullet lines, no leading dash) */
  notes?: string[];
}

export const CLI_GLOBAL_FLAGS: CliGlobalFlag[] = [
  { flag: "`--help` / `-h`", description: "Print help and exit." },
  { flag: "`--baseUrl <url>`", description: "LoxBerry base URL (overrides `LOXBERRY_BASE_URL`)." },
  { flag: "`--user <name>`", description: "Admin user (overrides `LOXBERRY_USERNAME`)." },
  { flag: "`--password <secret>`", description: "Password (overrides `LOXBERRY_PASSWORD`)." },
  { flag: "`--file <path>`", description: "Used by **`plugins upload`** — path to `.zip`." },
  { flag: "`--name <id>`", description: "Used by **`plugins uninstall`** — plugin md5 or folder name." },
  { flag: "`--follow`", description: "Used by **`logs install`** — poll generic install log until completion." },
  {
    flag: "`--params '<json>'`",
    description: "Used by **`jsonrpc call`** — JSON-RPC params (default `[]`).",
  },
];

export const CLI_COMMANDS: CliCommand[] = [
  {
    usage: "plugins list",
    summary: "Print installed plugins (JSON) from plugin admin list URL.",
  },
  {
    usage: "plugins upload --file ./plugin.zip",
    summary: "POST multipart upload to stock `plugininstall.cgi` (set `LOXBERRY_SECURE_PIN` for install).",
    notes: [
      "Does not wait on tempfile install log; use the library API (`followPluginInstallTempLog`) for automation.",
    ],
  },
  {
    usage: "plugins uninstall --name <md5-or-folder>",
    summary: "Two-step GET uninstall (confirm + `answer=1`), same as the web UI.",
  },
  {
    usage: "logs install",
    summary: "Read `getInstallLog()` (generic path; not the per-upload tempfile).",
    notes: ["Add `--follow` to poll until a completion phrase appears."],
  },
  {
    usage: "jsonrpc call <method> [--params '[]']",
    summary: "Call `/admin/system/jsonrpc.php` with session/Basic headers.",
  },
];

export const CLI_ENV_BLOCK = `| Variable | Purpose |
|----------|---------|
| \`LOXBERRY_BASE_URL\` | e.g. \`https://loxberry.local\` |
| \`LOXBERRY_USERNAME\` / \`LOXBERRY_PASSWORD\` | Web admin; sent as HTTP Basic on \`/admin\` (stock) |
| \`LOXBERRY_HTTP_BASIC_*\` | Optional separate Basic layer (see \`.env.example\`) |
| \`LOXBERRY_AUTH_STRATEGY\` | \`basic\` (default) or \`form\` |
| \`LOXBERRY_LOGIN_PATH\` | Form-login path if \`form\` |
| \`LOXBERRY_SECURE_PIN\` | Required for plugin install via upload API / MCP |`;

/** Console help (keeps parity with README table). */
export function formatCliHelpText(): string {
  const cmds = CLI_COMMANDS.map((c) => `  loxberry-client ${c.usage}`).join("\n");
  return `loxberry-client — LoxBerry 3.x-first HTTP + JSON-RPC helper

Usage:
${cmds}

Global flags (all subcommands):
${CLI_GLOBAL_FLAGS.map((f) => {
    const desc = f.description.replace(/\*\*/g, "");
    return `  ${f.flag.replace(/`/g, "")}  ${desc}`;
  }).join("\n")}

Env:
  LOXBERRY_BASE_URL  e.g. https://loxberry.local
  LOXBERRY_USERNAME  admin user (optional if endpoints are open)
  LOXBERRY_PASSWORD

  Stock LoxBerry: same user/password are sent as HTTP Basic on every /admin request (htmlauth/.htaccess).
  Override Basic only if different: LOXBERRY_HTTP_BASIC_USERNAME / LOXBERRY_HTTP_BASIC_PASSWORD
  or LOXBERRY_HTTP_BASIC_SAME=1 (explicit reuse).

  Legacy HTML form login: LOXBERRY_AUTH_STRATEGY=form and LOXBERRY_LOGIN_PATH if needed.

Options apply to all subcommands. This process does not read .env files; export variables in your shell or start Node with --env-file=.env (Node 20.6+).
`;
}

/** Markdown block for README (between HTML comment markers). */
export function formatCliReferenceMarkdown(): string {
  const flags = CLI_GLOBAL_FLAGS.map(
    (f) => `| ${f.flag} | ${f.description} |`,
  ).join("\n");
  const cmds = CLI_COMMANDS.map((c) => {
    const notes =
      c.notes && c.notes.length > 0
        ? `<br><small>${c.notes.join(" ")}</small>`
        : "";
    return `| \`loxberry-client ${c.usage}\` | ${c.summary}${notes} |`;
  }).join("\n");

  return [
    "Auto-generated from [`src/cli-reference.ts`](src/cli-reference.ts) — run `npm run docs:sync-cli` after changing commands.",
    "",
    "### Global flags",
    "",
    "| Flag | Description |",
    "|------|-------------|",
    flags,
    "",
    "### Commands",
    "",
    "| Command | Description |",
    "|---------|-------------|",
    cmds,
    "",
    "### Environment",
    "",
    CLI_ENV_BLOCK,
    "",
    "### Examples",
    "",
    "```bash",
    "npx loxberry-client plugins list --baseUrl https://loxberry.local --user admin --password \"$LOX_PASS\"",
    "npx loxberry-client plugins upload --file ./dist/myplugin.zip",
    "npx loxberry-client plugins uninstall --name <md5-or-folder>",
    "npx loxberry-client logs install --follow",
    "npx loxberry-client jsonrpc call LBSystem::get_miniservers --params '[]'",
    "```",
  ].join("\n");
}
