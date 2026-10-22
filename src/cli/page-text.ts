// Fetch pages with the resolver's own extractor for the verifier's offline run (003 T342, FR-019a): one URL
// per stdin line, one JSON line per page on stdout. The text goes only down this pipe, never to a file or log.
import { createInterface } from 'node:readline';
import { createReplayStore } from '../llm/replay.js';
import { createPageFetcher, EXTRACTOR_VERSION } from '../resolve/fetch.js';

const fetchPage = createPageFetcher({ mode: 'live', store: createReplayStore() });

for await (const line of createInterface({ input: process.stdin })) {
  const url = line.trim();
  if (!url) continue;
  try {
    const page = await fetchPage(url);
    const answer = {
      url,
      sha256: page.sha256,
      extractor: EXTRACTOR_VERSION,
      text: page.text,
    };
    process.stdout.write(JSON.stringify(answer) + '\n');
  } catch (error) {
    // The fetcher's messages carry the URL and status only, never a body.
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      JSON.stringify({ url, error: message.slice(0, 200) }) + '\n',
    );
  }
}
