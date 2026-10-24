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
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)

from verifier.train.fetch_data import DATA, ROOT, base_dir, dataset_file, teacher_dir

HERE = Path(__file__).resolve().parent
# A GPU when there is one (a free notebook), else the CPU; the run record names which (decision 004).
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CONFIG = tomllib.loads((HERE / "config.toml").read_text())
OUT = ROOT / "verifier" / "models" / "practice"
DISTILLED = ROOT / "verifier" / "models" / "practice-distilled"
DEBERTA = ROOT / "verifier" / "models" / "practice-deberta"
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


def encode(tokenizer, chunk):
    return tokenizer(
        [r[0] for r in chunk], [r[1] for r in chunk], truncation=CONFIG["truncation"],
        max_length=CONFIG["max_length"], padding=True, return_tensors="pt",
    ).to(DEVICE)


def batches(rows, tokenizer, size: int, shuffle: random.Random | None):
    """(student input, labels, the raw pairs) per batch; the pairs let a teacher tokenize them its own way."""
    order = list(range(len(rows)))
    if shuffle:
        shuffle.shuffle(order)
    for start in range(0, len(order), size):
        chunk = [rows[i] for i in order[start : start + size]]
        yield encode(tokenizer, chunk), torch.tensor([r[2] for r in chunk], device=DEVICE), chunk


def accuracy(model, rows, tokenizer) -> float:
    model.eval()
    right = 0
    with torch.no_grad():
        for encoded, labels, _ in batches(rows, tokenizer, 128, None):
            right += (model(**encoded).logits.argmax(-1) == labels).sum().item()
    model.train()
    return right / len(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-steps", type=int, help="stop after this many steps: the timing run")
    parser.add_argument("--distill", action="store_true", help="mix the teacher's answers into the loss (T344)")
    parser.add_argument("--base", choices=["minilm", "deberta"], default="minilm")
    args = parser.parse_args()
    base_key = "base_deberta" if args.base == "deberta" else "base"
    out = DEBERTA if args.base == "deberta" else DISTILLED if args.distill else OUT
    learning_rate = DATA[base_key].get("learning_rate", CONFIG["learning_rate"])

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

    tokenizer = AutoTokenizer.from_pretrained(base_dir(base_key))
    # float32 explicitly: the DeBERTa checkpoint is stored in fp16, and transformers keeps a file's precision.
    model = AutoModelForSequenceClassification.from_pretrained(
        base_dir(base_key),
        dtype=torch.float32,
        num_labels=len(LABELS),
        id2label=dict(enumerate(LABELS)),
        label2id={v: i for i, v in enumerate(LABELS)},
    ).to(DEVICE)
    teacher = teacher_tok = None
    if args.distill:
        teacher = AutoModelForSequenceClassification.from_pretrained(teacher_dir(), dtype=torch.float32)
        teacher = teacher.eval().to(DEVICE)
        teacher_tok = AutoTokenizer.from_pretrained(teacher_dir())
        if [teacher.config.id2label[i].lower() for i in range(len(LABELS))] != LABELS:
            raise SystemExit(f"teacher labels {teacher.config.id2label} are not {LABELS}")
    steps_per_epoch = -(-len(train) // CONFIG["batch_size"])
    total = args.max_steps or steps_per_epoch * CONFIG["epochs"]
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=CONFIG["weight_decay"])
    schedule = get_linear_schedule_with_warmup(optimizer, int(total * CONFIG["warmup_share"]), total)

    # fp16 autocast for the DeBERTa run on a GPU only: about twice as fast; the MiniLM runs stayed fp32.
    amp = args.base == "deberta" and DEVICE.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp)
    record = {
        "train_pairs": len(train), "development_pairs": len(dev), "dropped_from_file": len(table["label"]) - len(rows),
        "train_fingerprint": fingerprint(train), "development_fingerprint": fingerprint(dev),
        "base": DATA[base_key]["id"], "learning_rate": learning_rate, "config": CONFIG, "seed": seed,
        "torch": torch.__version__, "evaluations": [], "mixed_precision": amp,
        "device": torch.cuda.get_device_name(0) if DEVICE.type == "cuda" else "cpu",
        "distill": {"teacher": DATA["teacher"]["id"], **CONFIG["distill"]} if args.distill else None,
    }
    best, waited, step, started = -1.0, 0, 0, time.monotonic()
    shuffle = random.Random(seed + 1)
    model.train()
    done = False
    for epoch in range(CONFIG["epochs"]):
        for encoded, labels, chunk in batches(train, tokenizer, CONFIG["batch_size"], shuffle):
            with torch.autocast("cuda", dtype=torch.float16, enabled=amp):
                output = model(**encoded, labels=labels)
            loss = output.loss
            if teacher is not None:
                with torch.no_grad():
                    taught = teacher(**encode(teacher_tok, chunk)).logits
                t, alpha = CONFIG["distill"]["temperature"], CONFIG["distill"]["alpha"]
                soft = torch.nn.functional.kl_div(
                    torch.log_softmax(output.logits / t, -1), torch.softmax(taught / t, -1), reduction="batchmean"
                )
                loss = alpha * loss + (1 - alpha) * t * t * soft
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
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
                    model.save_pretrained(out / "best")
                    tokenizer.save_pretrained(out / "best")
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
    out.mkdir(parents=True, exist_ok=True)
    name = "timing.json" if args.max_steps else "run.json"
    (out / name).write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps({k: v for k, v in record.items() if k != "evaluations"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
