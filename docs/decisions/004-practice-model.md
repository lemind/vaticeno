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
| First experiment | supervised fine-tune on MultiNLI's train split **without its fiction genre**, three classes; SNLI for evaluation only | one clean baseline before any second idea; the data choice is the licence assessment's (below) |
| Second experiment, optional | distillation from the stock DeBERTa-v3-xsmall teacher, same data, split and student | the comparison is interesting only once the baseline is stable |
| Excluded | ANLI | CC BY-NC 4.0: not commercial |
| Machine | this laptop's CPU (no NVIDIA GPU); a free GPU notebook only if CPU time is unreasonable | benchmark the first 500–1,000 steps, then decide |
| Training libraries | `torch` (CPU), `transformers`, `pyarrow`, `onnx`, with onnxruntime and tokenizers — locked with hashes in `verifier/train/requirements.lock`, Python 3.12, in a laptop-only `.venv-train`, never installed on a server. Datasets are read from pinned parquet files, so no `datasets` library | constitution VII: approved for training, with this reason |
| Where the weights live | a public **Hugging Face Hub** model repo; the project pins its commit and file checksums in `verifier/model.toml` | weights never in git (003 FR-019) |
| Demo | an optional Hugging Face **Space**: premise and hypothesis in, three probabilities out; no URL fetching, no link to the bot, labelled "research demo, not used to decide Vaticeno outcomes" | public and tangible; built only after the evaluation works |

## Constitution V and training data

V forbids storing content: X posts and **the evidence the resolver fetches**. Downloading public research
corpora (MultiNLI, SNLI) to a laptop to train on them is not that: they are published datasets used under
their own licences, never mixed with fetched evidence, never committed. The in-domain challenge set is
**our own** short, original pairs (dates, negation, planned vs happened, quoted claims, numbers), labelled by
hand — not text from any source page.

## Evaluation rules

Benchmark NLI and Vaticeno-style checking are reported apart. Hyperparameters are chosen on the development split
only (carved from the training genres); every published split is scored once. The challenge set is written, labelled and frozen **before** any
training, grouped by phenomenon with counts; if it is ever used to fix the model, it is marked as development
and a fresh one is written. Calibration is per artefact: raw scores, then a temperature fitted on that
artefact's development-split logits (fp32 and int8 each their own), both reported on the same frozen test examples
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

### training_data_license_assessment (2026-10-23)

Read from each source at the pinned revision (`verifier/train/data.toml`):

| Source | Terms | Used for |
|---|---|---|
| MiniLM-L6-H384-uncased (base) | MIT, from Microsoft's MIT MiniLM-L12 | the starting weights |
| MultiNLI, every genre but fiction (government, slate, telephone, travel) | the Open American National Corpus: "unrestricted in terms of usage and redistribution … including commercial use" (anc.org) | **training** |
| MultiNLI, fiction | mixed: *Seven Swords* CC BY-SA 3.0; *Living History*, *Password Incorrect* CC BY 3.0; the rest US public domain, possibly licensed differently elsewhere | **dropped from training**; its pairs stay in the matched validation set, scored only |
| SNLI | CC BY-SA 4.0 | **evaluation only** (test split) |

Scoring a model on a dataset puts none of its text into the weights, so the evaluation sets do not reach the
artefact's licence — kept true by using them for nothing but the final score: checkpoint, early stopping and
temperature come from a development split carved from the non-fiction training pairs. The card cites every
dataset and names its licence, and reproduces no dataset pair. The cost is data, about 310k training pairs
instead of about 940k; what it costs in accuracy is measured and written on the card, not guessed here.

**The gap**: MultiNLI's premises come from the OANC, but its hypotheses were written by crowdworkers, and the
public documentation states corpus-level terms without mapping them to that layer. Dropping fiction removes
the corpus's only ShareAlike text; it does not by itself prove the hypotheses are covered. **Accepted as a
documented risk** (owner, 2026-10-23): the card states it, and the authors are not asked.

### weights_license

**MIT, conditionally** (owner, 2026-10-23): option B — no SNLI and no fiction in training — so the licence
does not rest on how ShareAlike treats weights. MIT rather than Apache-2.0: the base's own, and a patent clause
fixes nothing about data rights. The gap above is accepted as a documented risk, so nothing blocks publication. If
the hypotheses ever turn out not to be covered, option A applies and the weights are relicensed CC BY-SA 4.0,
which also covers the fiction's BY-SA 3.0.

On the card, each scope apart: the code under the repo's licence; the weights and int8 export under MIT; the
base model's MIT notice kept; the datasets cited with their own licences, which MIT on the weights does not
change; and a plain line that this follows the sources' stated terms without settling whether training makes
weights a derivative work.
