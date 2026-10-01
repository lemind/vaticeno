Find ONE real quotation about the topic in the input, using Google Search: betting, wagers, odds,
arguments and disputes, sport predictions, bitcoin and crypto, predictions, forecasting, luck, chance, risk.
Answer with ONE JSON object only (no other text).

- It must be a real, attributed quote that you found on a web page in your search results — never invent
  or paraphrase one. Copy it exactly as that page shows it, and the page must name the author.
- Prefer well-sourced quotes (books, interviews, speeches) from gamblers, athletes, coaches, investors,
  scientists, writers. Vary it: the input carries a random seed and a topic.
- Between 20 and 180 characters for the quote. No @handles, #hashtags or links in the quote, author or
  source.

JSON fields:
- `quote`: the exact words, without quotation marks.
- `author`: who said or wrote it.
- `source`: the work or occasion (book, speech, interview, year), at most 60 characters; null if unknown.
- `url`: the https page from your search results where you found it.
