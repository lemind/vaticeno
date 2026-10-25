---
language: en
license: mit
library_name: transformers
pipeline_tag: text-classification
base_model: microsoft/deberta-v3-xsmall
datasets:
- nyu-mll/multi_nli
tags:
- natural-language-inference
- nli
- deberta-v3
- onnx
- int8
model-index:
- name: deberta-v3-xsmall-nli-oanc
  results:
  - task: {type: text-classification, name: Natural Language Inference}
    dataset: {type: nyu-mll/multi_nli, name: MultiNLI, split: validation_matched}
    metrics:
    - {type: accuracy, value: 0.8765, name: Accuracy (fp32)}
  - task: {type: text-classification, name: Natural Language Inference}
    dataset: {type: nyu-mll/multi_nli, name: MultiNLI, split: validation_mismatched}
    metrics:
    - {type: accuracy, value: 0.8796, name: Accuracy (fp32)}
  - task: {type: text-classification, name: Natural Language Inference}
    dataset: {type: stanfordnlp/snli, name: SNLI, split: test}
    metrics:
    - {type: accuracy, value: 0.8279, name: Accuracy (fp32)}
---

# DeBERTa-v3-xsmall NLI (OANC-only training)

A three-way natural language inference classifier: given a **premise** and a **hypothesis**, it says whether
the premise entails the hypothesis, contradicts it, or neither. It is `microsoft/deberta-v3-xsmall` fine-tuned
on the part of MultiNLI whose text is free for any use, so the weights can carry a plain MIT licence.

It scores within half a point of the base model's published MultiNLI result while training on a third less data
and on one free GPU.

**A research and practice artefact.** It was built while exploring a local evidence checker for
[Vaticeno](https://github.com/lemind/vaticeno), a bot that resolves public predictions. It is **not** used by
Vaticeno to decide any outcome.

## Labels

| id | label |
|---|---|
| 0 | contradiction |
| 1 | entailment |
| 2 | neutral |

## Use

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

name = "Leminds/deberta-v3-xsmall-nli-oanc"
tok = AutoTokenizer.from_pretrained(name)
model = AutoModelForSequenceClassification.from_pretrained(name).eval()

batch = tok(["Bitcoin closed the day at $91,200."], ["Bitcoin closed above $90,000."], return_tensors="pt")
with torch.no_grad():
    probs = (model(**batch).logits / 1.61).softmax(-1)  # 1.61: the fitted temperature, see Calibration
print(dict(zip(model.config.id2label.values(), probs[0].tolist())))
# {'contradiction': 0.057, 'entailment': 0.852, 'neutral': 0.091}
```

With ONNX Runtime and no PyTorch, the int8 file `onnx/model_quint8_avx2.onnx` takes `input_ids` and
`attention_mask` (no `token_type_ids`) and returns `logits`; tokenize with `tokenizer.json` through the
`tokenizers` library. It was quantised for, and measured on, x86 CPUs with AVX2.

## Training data

| Source | Terms | Used for |
|---|---|---|
| MultiNLI train, genres government, slate, telephone, travel | Open American National Corpus: "unrestricted in terms of usage and redistribution … including commercial use" | **training**: 305,354 pairs |
| MultiNLI train, fiction genre | mixed; includes CC BY-SA 3.0 text | **dropped** (77,348 pairs) |
| MultiNLI validation (matched, mismatched) | as above | evaluation only |
| SNLI test | CC BY-SA 4.0 | evaluation only |

A further 10,000 training pairs were held out by seed as a development split. Every choice (best checkpoint,
calibration temperature) was made on it; the evaluation sets were scored once, at the end.

## Licence

- **Weights and ONNX exports**: MIT. The base model, `microsoft/deberta-v3-xsmall`, is MIT; its copyright
  notice is kept in `LICENSE`.
- **Training data**: only the MultiNLI genres listed above, which the corpus and the OANC describe as free for
  any use. The MultiNLI documentation states its terms at the corpus level; it does not separately state the
  terms of the crowd-written hypotheses. We read them as covered and record that as an assumption.
- **Evaluation datasets** keep their own licences (SNLI is CC BY-SA 4.0). Scoring a model on a dataset puts none
  of its text into the weights, and no dataset example is reproduced here.
- This follows the sources' stated terms. It does not settle the open question of whether training makes model
  weights a derivative work of their data.

## Training procedure

| | |
|---|---|
| Objective | supervised fine-tuning, cross-entropy over three classes |
| Optimiser | AdamW, learning rate 4.5e-5 (the base model's authors' MNLI setting), weight decay 0.01 |
| Schedule | linear, 6% warm-up, 3 epochs, 28,629 steps |
| Batch, length | 32 pairs with dynamic padding, 128 tokens, longest-first truncation |
| Precision | fp16 autocast with gradient scaling; weights kept in fp32 |
| Hardware | one Tesla T4 (Google Colab), 68 minutes, torch 2.11.0+cu130, transformers 5.20.2 |
| Seed | 20261023 |
| Selection | best development accuracy, checked every 2,000 steps: 87.27% at step 28,000 |

## Evaluation

All on data not used for training or for any choice. fp32 is the reference model; int8 is the dynamic-quantised
ONNX file, measured as itself.

| Set | n | fp32 accuracy | int8 accuracy | fp32 macro-F1 |
|---|---|---|---|---|
| MultiNLI matched (validation) | 9,815 | **87.7%** | 87.1% | 0.876 |
| … non-fiction genres | 7,842 | 87.9% | 87.4% | 0.879 |
| … fiction (a genre never trained on) | 1,973 | 86.6% | 85.8% | 0.865 |
| MultiNLI mismatched (validation) | 9,832 | **88.0%** | 87.4% | 0.879 |
| SNLI test (a dataset never trained on) | 9,824 | **82.8%** | 82.4% | 0.826 |

For reference, the base model's authors report 88.1% / 88.3% on MultiNLI matched / mismatched after fine-tuning
on all of MultiNLI with sequences of 256 tokens on 8 GPUs.

Per class, MultiNLI mismatched, fp32: contradiction precision 0.90 / recall 0.91, entailment 0.91 / 0.88,
neutral 0.83 / 0.85.

### Calibration

A single temperature fitted on the development split's logits, separately for each file: **1.61** (fp32),
**1.60** (int8). Dividing the logits by it changes no prediction.

| Set | file | ECE raw → calibrated | Brier raw → calibrated |
|---|---|---|---|
| MultiNLI mismatched | fp32 | 0.063 → 0.021 | 0.194 → 0.184 |
| MultiNLI mismatched | int8 | 0.063 → 0.016 | 0.198 → 0.188 |
| SNLI test | fp32 | 0.091 → 0.025 | 0.272 → 0.254 |

Error rate among the most confident answers, MultiNLI mismatched, fp32: 0.7% of the top 10%, 1.3% of the top
25%, 2.1% of the top 50%, 12.0% overall.

### A small hand-written challenge set

60 original pairs written for this project and frozen before training, 12 per group, 4 of each label in every
group. It probes cases a prediction checker meets. With 12 pairs a group, one answer moves a group by 8 points:
it shows kinds of failure, it does not rank models.

| Group | fp32 | int8 |
|---|---|---|
| attribution (said vs confirmed) | 10/12 | 9/12 |
| dates | 11/12 | 10/12 |
| negation | 10/12 | 10/12 |
| numbers | 10/12 | 9/12 |
| planned vs happened | 8/12 | 8/12 |

### Size and speed

One CPU thread, x86 laptop with AVX2, a bare process holding one ONNX Runtime session.

| | fp32 ONNX | int8 ONNX |
|---|---|---|
| File | 271 MiB | 83 MiB |
| Peak memory | 564 MiB | 320 MiB |
| One 128-token pair | 107 ms | 90 ms |
| One 512-token input | 633 ms | 560 ms |

## Limitations

- Trained on sentence pairs. Long documents must be split into windows, and how window scores combine is up to
  the caller and untested here.
- It reads only the text it is given. It does not know whether a source is trustworthy, whether an event fell
  inside a deadline, or whether two pages are about the same event.
- Its weakest challenge group is telling a plan or forecast from something that happened; "plans to launch next
  year" against "launched" comes out as contradiction (0.87) rather than neutral.
- It does not do the arithmetic behind a score: "The football team won the match 3-1" against "The team scored
  three goals in the match" comes out neutral (0.94), though it does reject "ended in a draw" (contradiction 0.96).
- English only. The fiction genre and SNLI scores show some transfer to unseen text, not robustness to it.
- High confidence is not proof: 0.7% of its most confident tenth of answers on MultiNLI mismatched are wrong.

## Comparison with a smaller student

The same pipeline with `nreimers/MiniLM-L6-H384-uncased` (22M parameters): 79.6% / 80.6% / 71.8% on matched /
mismatched / SNLI, 39/60 on the challenge set, 22 MiB int8 file. Distilling that student from a DeBERTa NLI
teacher moved MultiNLI by less than half a point.

## Reproduce

Everything is pinned by commit and sha256: the base model, each dataset file and the training environment
(lockfile with hashes). In the repository `lemind/vaticeno`, branch `003-stage3-verifier`:
`verifier/train/data.toml`, `config.toml`, `finetune.py --base deberta`, `evaluate.py --deberta`, and
`reproduce.sh`. A fixed seed gives the same results under the same environment, not bit-identical results on
every machine.

| File | sha256 |
|---|---|
| model.safetensors | `be3346d38d8ab52f998f08e4726a063e0a970254e82906cb6b277a794c3ac30a` |
| onnx/model_quint8_avx2.onnx | `3b2ed0906648776b4457a51ae7678950fa4a9147398e36410af9485e771f03ae` |
| tokenizer.json | `68e83b60c658f52c146e7ee46801922495af28a2977b4a63961fcbbf0ad66884` |

## Citations

- He, Gao and Chen. *DeBERTaV3: Improving DeBERTa using ELECTRA-Style Pre-Training with Gradient-Disentangled
  Embedding Sharing.* ICLR 2023.
- Williams, Nangia and Bowman. *A Broad-Coverage Challenge Corpus for Sentence Understanding through
  Inference.* NAACL 2018.
- Bowman, Angeli, Potts and Manning. *A large annotated corpus for learning natural language inference.*
  EMNLP 2015.
