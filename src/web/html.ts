// Server-rendered HTML with escaping by default: every interpolated value is escaped unless it is itself
// an `html` fragment. No client JS, except the wager page's one script (003 FR-045).

class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Part = Html | string | number | null | undefined | false | readonly Part[];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return '';
  if (part instanceof Html) return part.value;
  if (Array.isArray(part)) return part.map(render).join('');
  return escapeHtml(String(part));
}

export function html(strings: TemplateStringsArray, ...parts: Part[]): Html {
  let out = strings[0]!;
  parts.forEach((part, i) => {
    out += render(part) + strings[i + 1]!;
  });
  return new Html(out);
}

// Only http(s) links are ever rendered as hrefs; anything else becomes plain text.
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export const utc = (date: Date | null | undefined) =>
  date ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';

// Data for a page's script: JSON in a non-executing tag, with `<` escaped so no value can close it.
export function jsonData(id: string, value: unknown): Html {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  return new Html(`<script type="application/json" id="${id}">${json}</script>`);
}

export function layout(
  title: string,
  body: Html,
  opts: { script?: string } = {},
): string {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · Vaticeno</title>
        ${opts.script ? html`<script type="module" src="${opts.script}"></script>` : ''}
        <style>
          :root {
            --bg: #fbfaf7;
            --fg: #1d1d1b;
            --muted: #6b6a66;
            --line: #e3e0d8;
            --hit: #1f7a4d;
            --miss: #b3261e;
            --void: #6b6a66;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #161615;
              --fg: #ecebe6;
              --muted: #9c9a93;
              --line: #2d2c29;
              --hit: #5cc28f;
              --miss: #f08a80;
              --void: #9c9a93;
            }
          }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--fg);
            font:
              16px/1.5 system-ui,
              -apple-system,
              sans-serif;
          }
          main {
            max-width: 720px;
            margin: 0 auto;
            padding: 24px 16px 64px;
          }
          h1 {
            font-size: 1.35rem;
            line-height: 1.35;
            margin: 0 0 8px;
          }
          h2 {
            font-size: 1rem;
            margin: 32px 0 8px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--muted);
          }
          dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 4px 16px;
            margin: 0;
          }
          dt {
            color: var(--muted);
          }
          dd {
            margin: 0;
            overflow-wrap: anywhere;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.92rem;
          }
          th,
          td {
            text-align: left;
            padding: 6px 8px 6px 0;
            border-bottom: 1px solid var(--line);
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          th {
            color: var(--muted);
            font-weight: 500;
          }
          .status {
            display: inline-block;
            padding: 2px 8px;
            border: 1px solid var(--line);
            border-radius: 999px;
            font-size: 0.85rem;
          }
          .hit {
            color: var(--hit);
          }
          .miss {
            color: var(--miss);
          }
          .void {
            color: var(--void);
          }
          .muted {
            color: var(--muted);
          }
          a {
            color: inherit;
          }
          .scroll {
            overflow-x: auto;
          }
          .notice {
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 8px 12px;
          }
          button {
            font: inherit;
            font-size: 0.92rem;
            padding: 6px 14px;
            margin: 2px 6px 2px 0;
            border: 1px solid var(--line);
            border-radius: 999px;
            background: transparent;
            color: var(--fg);
            cursor: pointer;
          }
          button:hover:not(:disabled) {
            border-color: var(--fg);
          }
          button:focus-visible,
          input:focus-visible {
            outline: 2px solid var(--fg);
            outline-offset: 2px;
          }
          button:disabled {
            opacity: 0.45;
            cursor: not-allowed;
          }
          button.primary {
            background: var(--fg);
            color: var(--bg);
            border-color: var(--fg);
            font-weight: 600;
          }
          .busy {
            cursor: progress;
          }
          .offer {
            display: grid;
            gap: 14px;
            max-width: 380px;
            margin: 16px 0;
            padding: 16px;
            border: 1px solid var(--line);
            border-radius: 12px;
          }
          .offer .hint {
            margin: 0;
            font-size: 0.85rem;
          }
          .side {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            border: 0;
            margin: 0;
            padding: 0;
          }
          .side legend,
          .field > span:first-child {
            color: var(--muted);
            font-size: 0.85rem;
            margin-bottom: 6px;
          }
          .pick input {
            position: absolute;
            opacity: 0;
          }
          .pick span {
            display: block;
            text-align: center;
            padding: 8px 0;
            border: 1px solid var(--line);
            border-radius: 8px;
            font-weight: 600;
            letter-spacing: 0.04em;
            color: var(
              --muted
            ); /* neutral until picked: .hit and .miss colour the label */
            cursor: pointer;
          }
          .pick.hit input:checked + span {
            border-color: var(--hit);
            color: var(--hit);
            box-shadow: inset 0 0 0 1px var(--hit);
          }
          .pick.miss input:checked + span {
            border-color: var(--miss);
            color: var(--miss);
            box-shadow: inset 0 0 0 1px var(--miss);
          }
          .pick input:focus-visible + span {
            outline: 2px solid var(--fg);
            outline-offset: 2px;
          }
          .field {
            display: grid;
          }
          .amount {
            display: flex;
            align-items: center;
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 0 12px;
          }
          .amount:focus-within {
            border-color: var(--fg);
          }
          .amount input {
            flex: 1;
            min-width: 0;
            font: inherit;
            font-size: 1.1rem;
            font-variant-numeric: tabular-nums;
            padding: 8px 0;
            border: 0;
            background: transparent;
            color: var(--fg);
            outline: none;
          }
          .amount .unit {
            color: var(--muted);
            font-size: 0.9rem;
          }
          #tx-status:empty {
            display: none;
          }
        </style>
      </head>
      <body>
        <main>${body}</main>
      </body>
    </html>`.value;
}
