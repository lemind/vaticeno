"""Export, quantise and measure the practice model (003 T343b, docs/decisions/004-practice-model.md).

    .venv-train/bin/python -m verifier.train.evaluate

fp32 ONNX is the reference artefact, int8 the deployment one; each is scored on its own, raw and then with a
temperature fitted on its own development-split logits. Benchmarks are scored once; the challenge set by group.
Writes `verifier/train/report.json` and `report.md`: numbers only, no dataset pair reproduced.
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from tokenizers import Tokenizer
from transformers import AutoModelForSequenceClassification

from verifier.fetch_model import sha256_of
from verifier.train.fetch_data import DATA, ROOT, dataset_file
from verifier.train.finetune import CONFIG, DISTILLED, LABELS, OUT, TO_OURS, fingerprint, training_rows

# `--distilled` measures the T344 run instead; every path follows the run directory.
RUN = DISTILLED if "--distilled" in sys.argv else OUT
BEST = RUN / "best"
FP32 = RUN / "model_fp32.onnx"
INT8 = RUN / "model_quint8_avx2.onnx"
REPORT = ROOT / "verifier" / "train" / ("report-distilled.json" if RUN == DISTILLED else "report.json")
INPUTS = ["input_ids", "attention_mask", "token_type_ids"]
BINS = 15


def export() -> None:
    model = AutoModelForSequenceClassification.from_pretrained(BEST).eval()
    dummy = {k: torch.ones((1, 8), dtype=torch.long) for k in INPUTS}
    dynamic = {k: {0: "batch", 1: "sequence"} for k in INPUTS} | {"logits": {0: "batch"}}
    torch.onnx.export(model, (dummy,), FP32, input_names=INPUTS, output_names=["logits"],
                      dynamic_axes=dynamic, opset_version=17, dynamo=False)
    # AVX2 without VNNI on the droplet and the laptop, as the stock candidate's file (verifier/model.toml).
    quantize_dynamic(FP32, INT8, weight_type=QuantType.QUInt8)


def tokenizer() -> Tokenizer:
    tok = Tokenizer.from_file(str(BEST / "tokenizer.json"))
    tok.enable_truncation(CONFIG["max_length"], strategy=CONFIG["truncation"])
    tok.enable_padding()
    return tok


def session(path: Path, threads: int) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def logits_for(sess, tok, pairs: list[tuple[str, str]]) -> np.ndarray:
    out = []
    for start in range(0, len(pairs), 64):
        enc = tok.encode_batch(pairs[start : start + 64])
        feed = {
            "input_ids": np.array([e.ids for e in enc], dtype=np.int64),
            "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
            "token_type_ids": np.array([e.type_ids for e in enc], dtype=np.int64),
        }
        out.append(sess.run(None, feed)[0])
    return np.concatenate(out)


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(logits: np.ndarray, labels: np.ndarray) -> float:
    """The T minimising negative log-likelihood, by golden-section search over [0.05, 10]."""
    def nll(t: float) -> float:
        p = softmax(logits / t)
        return float(-np.log(p[np.arange(len(labels)), labels] + 1e-12).mean())
    lo, hi = 0.05, 10.0
    g = (5 ** 0.5 - 1) / 2
    a, b = hi - g * (hi - lo), lo + g * (hi - lo)
    for _ in range(60):
        if nll(a) < nll(b):
            hi, b = b, a
            a = hi - g * (hi - lo)
        else:
            lo, a = a, b
            b = lo + g * (hi - lo)
    return round((lo + hi) / 2, 4)


def metrics(probs: np.ndarray, labels: np.ndarray) -> dict:
    pred = probs.argmax(1)
    conf = probs.max(1)
    confusion = np.zeros((3, 3), dtype=int)
    for t, p in zip(labels, pred, strict=True):
        confusion[t, p] += 1
    per_class, f1s = {}, []
    for i, name in enumerate(LABELS):
        tp = confusion[i, i]
        precision = tp / max(confusion[:, i].sum(), 1)
        recall = tp / max(confusion[i, :].sum(), 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-12)
        f1s.append(f1)
        per_class[name] = {"precision": round(float(precision), 4), "recall": round(float(recall), 4)}
    edges = np.linspace(0, 1, BINS + 1)
    ece, reliability = 0.0, []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        inside = (conf > lo) & (conf <= hi)
        if inside.any():
            acc, mean_conf = float((pred[inside] == labels[inside]).mean()), float(conf[inside].mean())
            ece += inside.mean() * abs(acc - mean_conf)
            reliability.append({"bin": [round(lo, 3), round(hi, 3)], "n": int(inside.sum()),
                                "accuracy": round(acc, 4), "confidence": round(mean_conf, 4)})
    onehot = np.eye(3)[labels]
    order = np.argsort(-conf)
    coverage = {}
    for share in (0.1, 0.25, 0.5, 0.75, 1.0):
        kept = order[: max(1, int(len(order) * share))]
        coverage[str(share)] = round(float((pred[kept] != labels[kept]).mean()), 4)
    return {
        "n": int(len(labels)),
        "accuracy": round(float((pred == labels).mean()), 4),
        "macro_f1": round(float(np.mean(f1s)), 4),
        "per_class": per_class,
        "confusion_rows_true_cols_predicted": confusion.tolist(),
        "ece": round(float(ece), 4),
        "brier": round(float(((probs - onehot) ** 2).sum(1).mean()), 4),
        "error_at_coverage": coverage,  # error rate among the most confident share of pairs
        "reliability": reliability,
    }


def benchmark(source: dict, name: str, genre: str | None = None, drop_genre: str | None = None):
    t = pq.read_table(dataset_file(source, name), columns=["premise", "hypothesis", "label", "genre"]
                      if "multi_nli" in source["id"] else ["premise", "hypothesis", "label"]).to_pydict()
    keep = [i for i, label in enumerate(t["label"]) if label != -1
            and (genre is None or t["genre"][i] == genre) and (drop_genre is None or t["genre"][i] != drop_genre)]
    return [(t["premise"][i], t["hypothesis"][i]) for i in keep], np.array([TO_OURS[t["label"][i]] for i in keep])


def development_split():
    source = DATA["train"]["multi_nli"]
    table = pq.read_table(dataset_file(source, next(iter(source["files"]))),
                          columns=["premise", "hypothesis", "label", "genre", "pairID"]).to_pydict()
    rows = training_rows(table, source["genres_dropped"], source["labels_dropped"])
    random.Random(DATA["seed"]).shuffle(rows)
    dev = rows[: source["development_pairs"]]
    expected = json.loads((RUN / "run.json").read_text())["development_fingerprint"]
    if fingerprint(dev) != expected:
        raise SystemExit("the development split differs from the one training used")
    return [(r[0], r[1]) for r in dev], np.array([r[2] for r in dev])


def footprint(path: Path) -> dict:
    """Cold start and peak RSS in a fresh process, one thread, one 128- and one 512-token pair."""
    code = f"""
import time, numpy as np, onnxruntime as ort
t = time.monotonic()
o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1; o.enable_cpu_mem_arena = False
s = ort.InferenceSession({str(path)!r}, o, providers=["CPUExecutionProvider"])
load = time.monotonic() - t
lat = {{}}
for n in (128, 512):
    x = np.ones((1, n), dtype=np.int64); feed = {{"input_ids": x, "attention_mask": x, "token_type_ids": 0 * x}}
    s.run(None, feed); t = time.monotonic()
    for _ in range(20): s.run(None, feed)
    lat[n] = (time.monotonic() - t) / 20
# VmHWM, not ru_maxrss: a child's ru_maxrss carries its parent's peak across fork and exec on Linux.
hwm = next(int(l.split()[1]) for l in open("/proc/self/status") if l.startswith("VmHWM"))
print(load, lat[128], lat[512], hwm / 1024)
"""
    load, l128, l512, rss = map(float, subprocess.run([sys.executable, "-c", code], capture_output=True,
                                                      text=True, check=True).stdout.split())
    return {"file_mib": round(path.stat().st_size / 2**20, 1), "cold_start_s": round(load, 2),
            "latency_ms_128_tokens": round(l128 * 1000, 1), "latency_ms_512_tokens": round(l512 * 1000, 1),
            "peak_rss_mib": round(rss, 1), "sha256": sha256_of(path)}


def smoke(sess, tok) -> None:
    """The exported file answers in the pinned class order with finite scores (not a quality check)."""
    pairs = [("The team won 3-1.", "The team scored three goals."), ("The team won 3-1.", "The match ended 2-1.")]
    z = logits_for(sess, tok, pairs)
    assert z.shape == (2, 3) and np.isfinite(z).all(), z
    p = softmax(z)
    assert p[0, LABELS.index("entailment")] > p[1, LABELS.index("entailment")], p


def main() -> int:
    export()
    tok = tokenizer()
    dev_pairs, dev_labels = development_split()
    mnli, snli = DATA["eval"]["multi_nli"], DATA["eval"]["snli"]
    matched, mismatched = list(mnli["files"])
    sets = {
        "mnli_matched_validation": benchmark(mnli, matched),
        "mnli_matched_validation_non_fiction": benchmark(mnli, matched, drop_genre="fiction"),
        "mnli_matched_validation_fiction": benchmark(mnli, matched, genre="fiction"),
        "mnli_mismatched_validation": benchmark(mnli, mismatched),
        "snli_test": benchmark(snli, next(iter(snli["files"]))),
    }
    challenge = [json.loads(line) for line in (ROOT / DATA["challenge"]["file"]).read_text().splitlines()]
    report = {"model": {"base": DATA["base"]["id"], "run": json.loads((RUN / "run.json").read_text())},
              "artefacts": {}}
    for name, path in (("fp32", FP32), ("int8", INT8)):
        sess = session(path, threads=8)
        smoke(sess, tok)
        temperature = fit_temperature(logits_for(sess, tok, dev_pairs), dev_labels)
        entry = {"temperature_fitted_on": "development split", "temperature": temperature, "sets": {}}
        for set_name, (pairs, labels) in sets.items():
            z = logits_for(sess, tok, pairs)
            entry["sets"][set_name] = {"raw": metrics(softmax(z), labels),
                                       "calibrated": metrics(softmax(z / temperature), labels)}
        z = logits_for(sess, tok, [(c["premise"], c["hypothesis"]) for c in challenge])
        pred = [LABELS[i] for i in z.argmax(1)]
        groups = sorted({c["group"] for c in challenge})
        right = [p == c["label"] for p, c in zip(pred, challenge, strict=True)]
        entry["challenge"] = {
            g: f"{sum(r for r, c in zip(right, challenge, strict=True) if c['group'] == g)}/"
            f"{sum(c['group'] == g for c in challenge)}"
            for g in groups
        }
        entry["engineering"] = footprint(path)
        report["artefacts"][name] = entry
        print(name, json.dumps({k: v["raw"]["accuracy"] for k, v in entry["sets"].items()}), entry["challenge"],
              flush=True)
    REPORT.write_text(json.dumps(report, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "true")
    sys.exit(main())
