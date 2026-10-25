# vaticeno-verifier

Reads an evidence page against a claim with
[Leminds/deberta-v3-xsmall-nli-oanc](https://huggingface.co/Leminds/deberta-v3-xsmall-nli-oanc) and answers
with its strongest entailment and contradiction. It decides nothing: the bot records its answers beside the
paid model's verdict (shadow mode). No database, nothing stored, no request text in any log.

Runs as a private Cloud Run service (docs/decisions/005-verifier-on-cloud-run.md): a call needs a Google
identity token for an account with `run.invoker`, and the header `X-Verifier-Key`.

    POST /score   {"premise": "...", "hypothesis": "..."}
    GET  /health

Deploy: `PROJECT=<project id> verifier/serve/deploy.sh`.
