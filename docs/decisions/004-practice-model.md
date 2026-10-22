# 004 — A small NLI model, trained for practice and published

**Date**: 2026-10-22 · **Decided by**: the owner · **Status**: accepted; the weights' licence is open (below) ·
**Relates to**: 003 FR-019, FR-019b, T343; constitution V and VII

## Why

The production fast path is paused: about $0.04–0.16 a month to save at today's volume, a go-live count
(003 SC-005) years away, and a stock candidate that does not fit the droplet (003 T342). Training a small model
is still worth doing — as **practice and a public portfolio piece**, not as a production step. Nothing it
produces decides a verdict; reaching production would still need SC-005's count like any other candidate.

## Chosen

| Item | Choice | Why |
|---|---|---|
| Base | `nreimers/MiniLM-L6-H384-uncased`, MIT, ~22M parameters | small enough to train on a CPU and to have a chance of fitting the droplet. A base encoder, not an NLI model: the MiniLM paper's 83.3% MNLI-m is its architecture after fine-tuning, a reference, not this checkpoint's score |
| First experiment | supervised fine-tune on SNLI + MultiNLI train splits, three classes | one clean baseline before any second idea |
| Second experiment, optional | distillation from the stock DeBERTa-v3-xsmall teacher, same data, split and student | the comparison is interesting only once the baseline is stable |
| Excluded | ANLI | CC BY-NC 4.0: not commercial |
| Machine | this laptop's CPU (no NVIDIA GPU); a free GPU notebook only if CPU time is unreasonable | benchmark the first 500–1,000 steps, then decide |
| Training libraries | `torch`, `transformers`, `datasets`, `optimum`/onnx export — a laptop-only `train` group, never installed on a server | constitution VII: approved for training, with this reason |
| Where the weights live | a public **Hugging Face Hub** model repo; the project pins its commit and file checksums in `verifier/model.toml` | weights never in git (003 FR-019) |
| Demo | an optional Hugging Face **Space**: premise and hypothesis in, three probabilities out; no URL fetching, no link to the bot, labelled "research demo, not used to decide Vaticeno outcomes" | public and tangible; built only after the evaluation works |

## Constitution V and training data

V forbids storing content: X posts and **the evidence the resolver fetches**. Downloading public research
corpora (SNLI, MultiNLI) to a laptop to train on them is not that: they are published datasets used under
their own licences, never mixed with fetched evidence, never committed. The in-domain challenge set is
**our own** short, original pairs (dates, negation, planned vs happened, quoted claims, numbers), labelled by
hand — not text from any source page.

## Evaluation rules

Benchmark NLI and Vaticeno-style checking are reported apart. Hyperparameters are chosen on validation splits
only; the held-out splits are scored once. The challenge set is written, labelled and frozen **before** any
training, grouped by phenomenon with counts; if it is ever used to fix the model, it is marked as development
and a fresh one is written. Calibration is per artefact: raw scores, then a temperature fitted on that
artefact's validation logits (fp32 and int8 each their own), both reported on the same frozen test examples
with the temperature and its split named — never fitted on test, the challenge set or the eight pages.
Split names are what they are (MNLI matched and mismatched **validation**, SNLI **test**). Reported: accuracy, macro-F1, confusion matrix, per-class
precision and recall, reliability diagram, ECE, Brier, error-versus-coverage; fp32 against int8 on all of
them plus file size, latency per window and peak RSS, cold start apart from steady state. The eight
reproducible pages from T342 are a footnote, never a headline.

## Reproducibility

One command (`verifier/train/reproduce.sh`) runs training, export, quantisation and evaluation in order, under:
the base model and tokenizer at immutable commits; dataset revisions as commit IDs, never `main`; exact splits,
filters (MultiNLI's label −1 dropped and counted), label mapping and sampling; a lockfile for the `train`
group with its transitive dependencies, and the Python version; seed, hyperparameters and the command;
max length, pair truncation, special tokens and normalisation; a fingerprint of each processed split; and
checksums of every output artefact. A fixed seed promises the same results under that environment, not
bit-for-bit identity on every machine.

## Open: the weights' licence — blocks publication

SNLI is CC BY-SA 4.0. MultiNLI is mixed: mostly the Open American National Corpus under permissive terms, with
portions under other terms, CC BY-SA 3.0 among them. Whether ShareAlike reaches model weights depends on
copyright and jurisdiction and is unsettled. Two separate records, both before any upload:

- **training_data_license_assessment** — each source's terms, the MultiNLI portions or filters actually used,
  and why the chosen release fits them;
- **weights_license** — the one licence the published artefact carries, stated plainly on the model card.

| Option | Meaning |
|---|---|
| A | a conservative route to investigate, subject to that review: CC BY-SA 4.0 weights with SNLI and MultiNLI attribution; code keeps the repo's own licence |
| B | train only on data whose terms allow the chosen weights licence without doubt, at some cost in accuracy (SNLI is not such data) |
| C | a legal review, if the weights must be MIT/Apache |

The card may say the law on training is uncertain; it never leaves the artefact's own licence ambiguous. Until
both records exist, T343d stays blocked.
