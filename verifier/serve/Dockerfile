# The verifier service (003 T346, decision 005). Built from the files deploy.sh assembles.
FROM python:3.12-slim
# Runs as an unprivileged uid 1000; the model is fetched at build time into a folder that user owns.
RUN useradd -m -u 1000 user
WORKDIR /app
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user verifier/ verifier/
USER user
# Downloads the pinned model, checks every sha256 and loads it once: a bad file fails the build, not a request.
RUN python -c "import os; os.environ['VERIFIER_KEY'] = 'build'; import verifier.serve.app"
EXPOSE 7860
CMD ["uvicorn", "verifier.serve.app:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log"]
