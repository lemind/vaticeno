// Server-rendered HTML with escaping by default: every interpolated value is escaped unless it is itself
// an `html` fragment. No client JS (contracts/http.md).

class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Part = Html | string | number | null | undefined | false | readonly Part[];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return '';
  if (part instanceof Html) return part.value;
  if (Array.isArray(part)) return part.map(render).join('');
  return escapeHtml(String(part));
}

export function html(strings: TemplateStringsArray, ...parts: Part[]): Html {
  let out = strings[0]!;
  parts.forEach((part, i) => { out += render(part) + strings[i + 1]!; });
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

export const utc = (date: Date | null | undefined) => (date ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—');

export function layout(title: string, body: Html): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Vaticeno</title>
<style>
  :root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8; --hit: #1f7a4d; --miss: #b3261e; --void: #6b6a66; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #9c9a93; --line: #2d2c29; --hit: #5cc28f; --miss: #f08a80; --void: #9c9a93; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.35rem; line-height: 1.35; margin: 0 0 8px; }
  h2 { font-size: 1rem; margin: 32px 0 8px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
  dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th, td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
  th { color: var(--muted); font-weight: 500; }
  .status { display: inline-block; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: .85rem; }
  .hit { color: var(--hit); } .miss { color: var(--miss); } .void { color: var(--void); }
  .muted { color: var(--muted); } a { color: inherit; }
  .scroll { overflow-x: auto; }
</style>
</head>
<body><main>${body}</main></body>
</html>`.value;
}
