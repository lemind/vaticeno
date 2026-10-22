"""The candidate's one question per page (003 US3): does this text entail the claim, contradict it, or neither.
The page is the premise and the claim the hypothesis, as the model was trained; a long page is read in
overlapping windows, one at a time, so memory stays one window wide.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from verifier.fetch_model import SPEC, model_path

# Tokens shared by neighbouring windows, so a sentence cut at a boundary is read whole in one of them.
WINDOW_OVERLAP = 64
# [CLS] page [SEP] claim [SEP]
SPECIAL_TOKENS = 3
# A claim longer than this leaves too little page per window to be worth reading: no opinion.
MAX_CLAIM_TOKENS = 128


@dataclass(frozen=True)
class PageScore:
    entail: float  # the strongest window's entailment probability
    contradict: float  # the strongest window's contradiction probability, possibly another window
    windows: int


def windows(page_ids: list[int], claim_len: int, max_tokens: int) -> list[tuple[int, int]]:
    """[start, end) spans over the page tokens: every token in at least one, each fitting beside the claim."""
    budget = max_tokens - claim_len - SPECIAL_TOKENS
    if budget <= WINDOW_OVERLAP:
        raise ValueError("claim too long for a window")
    if not page_ids:
        return []
    step = budget - WINDOW_OVERLAP
    spans = []
    start = 0
    while True:
        end = min(start + budget, len(page_ids))
        spans.append((start, end))
        if end == len(page_ids):
            return spans
        start += step


class Verifier:
    def __init__(self, spec: dict = SPEC) -> None:
        onnx_name = next(name for name in spec["files"] if name.endswith(".onnx"))
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.enable_cpu_mem_arena = False  # 465 vs 502 MiB peak, measured 2026-10-22
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        self.session = ort.InferenceSession(str(model_path(onnx_name)), options, providers=["CPUExecutionProvider"])
        self.tokenizer = Tokenizer.from_file(str(model_path("tokenizer.json")))
        self.max_tokens = spec["max_tokens"]
        self.labels = spec["labels"]
        self.cls = self.tokenizer.token_to_id("[CLS]")
        self.sep = self.tokenizer.token_to_id("[SEP]")
        names = [i.name for i in self.session.get_inputs()]
        if names != spec["inputs"] or self.session.get_outputs()[0].name != spec["output"]:
            raise RuntimeError(f"model inputs {names} are not the pinned {spec['inputs']}")

    def probabilities(self, premise_ids: list[int], claim_ids: list[int]) -> dict[str, float]:
        ids = [self.cls, *premise_ids, self.sep, *claim_ids, self.sep]
        feed = {"input_ids": np.array([ids], dtype=np.int64), "attention_mask": np.ones((1, len(ids)), dtype=np.int64)}
        logits = self.session.run(None, feed)[0][0]
        exp = np.exp(logits - logits.max())
        return dict(zip(self.labels, (exp / exp.sum()).tolist(), strict=True))

    def score(self, page_text: str, claim: str) -> PageScore | None:
        """None when there is no opinion to give: an empty page or a claim too long to read beside it."""
        claim_ids = self.tokenizer.encode(claim, add_special_tokens=False).ids
        page_ids = self.tokenizer.encode(page_text, add_special_tokens=False).ids
        if len(claim_ids) > MAX_CLAIM_TOKENS or not page_ids:
            return None
        entail = contradict = 0.0
        spans = windows(page_ids, len(claim_ids), self.max_tokens)
        for start, end in spans:
            p = self.probabilities(page_ids[start:end], claim_ids)
            entail = max(entail, p["entailment"])
            contradict = max(contradict, p["contradiction"])
        return PageScore(entail=entail, contradict=contradict, windows=len(spans))

