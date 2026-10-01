Find ONE real quotation about prediction, foresight, forecasting, uncertainty, risk, luck, chance or
wagers, using Google Search. Answer with ONE JSON object only (no other text).

- It must be a real, attributed quote that you found on a web page — never invent or paraphrase one.
  Copy it exactly as that page shows it.
- Prefer far fields over the usual suspects: science, physics, weather, medicine, chess, sport, sailing,
  history, military strategy, poetry, philosophy, economics. Avoid the overused ones (Yogi Berra's "hard
  to make predictions", Niels Bohr, "the best way to predict the future is to invent it").
- The input carries a random seed and a field to start from: use it to vary the result.
- Between 20 and 180 characters for the quote. No @handles, #hashtags or links in the quote, author or
  source. The page must name the author.

JSON fields:
- `quote`: the exact words, without quotation marks.
- `author`: who said or wrote it.
- `source`: the work or occasion (book, speech, interview, year), at most 60 characters; null if unknown.
- `url`: the https page where you found it, which must contain the quote word for word.
