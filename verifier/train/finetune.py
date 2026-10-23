"""Fine-tune the practice model (003 T343a, docs/decisions/004-practice-model.md): MiniLM on MultiNLI without its
fiction genre. Checkpoint and early stopping use the development split carved from the training pairs; no
evaluation set is read here.

    .venv-train/bin/python -m verifier.train.finetune [--max-steps N]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
import tomllib
from pathlib import Path

import pyarrow.parquet as pq
import torch
from transformers import AutoModelForSequenceClassification, BertTokenizerFast, get_linear_schedule_with_warmup

from verifier.train.fetch_data import DATA, ROOT, base_dir, dataset_file

HERE = Path(__file__).resolve().parent
# A GPU when there is one (a free notebook), else the CPU; the run record names which (decision 004).
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CONFIG = tomllib.loads((HERE / "config.toml").read_text())
OUT = ROOT / "verifier" / "models" / "practice"
LABELS = DATA["labels"]["order"]
# Dataset label number → our class index.
TO_OURS = {int(k): LABELS.index(v) for k, v in DATA["labels"]["from_dataset"].items()}


def training_rows(table: dict, dropped_genres: list[str], dropped_labels: list[int]) -> list[tuple[str, str, int, str]]:
    """(premise, hypothesis, our label, pair id) for every pair that may be trained on."""
    return [
        (p, h, TO_OURS[label], pair)
        for p, h, label, genre, pair in zip(
            table["premise"], table["hypothesis"], table["label"], table["genre"], table["pairID"], strict=True
        )
        if genre not in dropped_genres and label not in dropped_labels
    ]


def assert_no_dropped_genre(rows: list[tuple[str, str, int, str]], table: dict, dropped: list[str]) -> None:
    genre_of = dict(zip(table["pairID"], table["genre"], strict=True))
    leaked = [pair for *_, pair in rows if genre_of[pair] in dropped]
    if leaked:
        raise AssertionError(f"{len(leaked)} pairs from a dropped genre reached training")


def fingerprint(rows: list[tuple[str, str, int, str]]) -> str:
    digest = hashlib.sha256()
    for *_, label, pair in rows:
        digest.update(f"{pair}:{label}\n".encode())
    return digest.hexdigest()


def batches(rows, tokenizer, size: int, shuffle: random.Random | None):
    order = list(range(len(rows)))
    if shuffle:
        shuffle.shuffle(order)
    for start in range(0, len(order), size):
        chunk = [rows[i] for i in order[start : start + size]]
        encoded = tokenizer(
            [r[0] for r in chunk], [r[1] for r in chunk], truncation=CONFIG["truncation"],
            max_length=CONFIG["max_length"], padding=True, return_tensors="pt",
        )
        yield encoded.to(DEVICE), torch.tensor([r[2] for r in chunk], device=DEVICE)


def accuracy(model, rows, tokenizer) -> float:
    model.eval()
    right = 0
    with torch.no_grad():
        for encoded, labels in batches(rows, tokenizer, 128, None):
            right += (model(**encoded).logits.argmax(-1) == labels).sum().item()
    model.train()
    return right / len(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-steps", type=int, help="stop after this many steps: the timing run")
    args = parser.parse_args()

    source = DATA["train"]["multi_nli"]
    seed = DATA["seed"]
    random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(CONFIG["threads"])  # CPU only; 4 measured fastest here (2026-10-23)

    table = pq.read_table(
        dataset_file(source, next(iter(source["files"]))), columns=["premise", "hypothesis", "label", "genre", "pairID"]
    ).to_pydict()
    rows = training_rows(table, source["genres_dropped"], source["labels_dropped"])
    assert_no_dropped_genre(rows, table, source["genres_dropped"])
    random.Random(seed).shuffle(rows)
    dev, train = rows[: source["development_pairs"]], rows[source["development_pairs"] :]

    tokenizer = BertTokenizerFast.from_pretrained(base_dir())
    model = AutoModelForSequenceClassification.from_pretrained(
        base_dir(),
        num_labels=len(LABELS),
        id2label=dict(enumerate(LABELS)),
        label2id={v: i for i, v in enumerate(LABELS)},
    ).to(DEVICE)
    steps_per_epoch = -(-len(train) // CONFIG["batch_size"])
    total = args.max_steps or steps_per_epoch * CONFIG["epochs"]
    optimizer = torch.optim.AdamW(model.parameters(), lr=CONFIG["learning_rate"], weight_decay=CONFIG["weight_decay"])
    schedule = get_linear_schedule_with_warmup(optimizer, int(total * CONFIG["warmup_share"]), total)

    record = {
        "train_pairs": len(train), "development_pairs": len(dev), "dropped_from_file": len(table["label"]) - len(rows),
        "train_fingerprint": fingerprint(train), "development_fingerprint": fingerprint(dev),
        "config": CONFIG, "seed": seed, "torch": torch.__version__, "evaluations": [],
        "device": torch.cuda.get_device_name(0) if DEVICE.type == "cuda" else "cpu",
    }
    best, waited, step, started = -1.0, 0, 0, time.monotonic()
    shuffle = random.Random(seed + 1)
    model.train()
    done = False
    for epoch in range(CONFIG["epochs"]):
        for encoded, labels in batches(train, tokenizer, CONFIG["batch_size"], shuffle):
            loss = model(**encoded, labels=labels).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            optimizer.zero_grad()
            step += 1
            if args.max_steps and step >= args.max_steps:
                done = True
                break
            if step % CONFIG["eval_every_steps"] == 0:
                score = accuracy(model, dev, tokenizer)
                record["evaluations"].append({"step": step, "epoch": epoch, "dev_accuracy": round(score, 4),
                                              "minutes": round((time.monotonic() - started) / 60, 1)})
                print(json.dumps(record["evaluations"][-1]), flush=True)
                if score > best:
                    best, waited = score, 0
                    model.save_pretrained(OUT / "best")
                    tokenizer.save_pretrained(OUT / "best")
                else:
                    waited += 1
                    if waited >= CONFIG["patience"]:
                        done = True
                        break
        if done:
            break

    seconds = time.monotonic() - started
    record |= {"steps": step, "seconds": round(seconds, 1), "seconds_per_step": round(seconds / max(step, 1), 3),
               "estimated_hours_per_epoch": round(seconds / max(step, 1) * steps_per_epoch / 3600, 2),
               "best_dev_accuracy": round(best, 4) if best >= 0 else None}
    OUT.mkdir(parents=True, exist_ok=True)
    name = "timing.json" if args.max_steps else "run.json"
    (OUT / name).write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps({k: v for k, v in record.items() if k != "evaluations"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
