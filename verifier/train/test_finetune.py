"""The fiction genre never reaches training (003 T343a, decision 004). Runs in .venv-train:

    .venv-train/bin/python -m pytest verifier/train
"""

import pytest

from verifier.train.finetune import LABELS, assert_no_dropped_genre, training_rows

TABLE = {
    "premise": ["a", "b", "c", "d"],
    "hypothesis": ["w", "x", "y", "z"],
    "label": [0, 1, 2, -1],
    "genre": ["travel", "fiction", "slate", "government"],
    "pairID": ["1e", "2n", "3c", "4x"],
}


def test_fiction_and_unlabelled_pairs_are_dropped_and_labels_mapped():
    rows = training_rows(TABLE, ["fiction"], [-1])
    assert [r[3] for r in rows] == ["1e", "3c"]
    assert [LABELS[r[2]] for r in rows] == ["entailment", "contradiction"]
    assert_no_dropped_genre(rows, TABLE, ["fiction"])


def test_a_fiction_pair_that_slips_through_is_caught():
    with pytest.raises(AssertionError):
        assert_no_dropped_genre([("b", "x", 2, "2n")], TABLE, ["fiction"])
