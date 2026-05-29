FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Téléchargement de Lexique3 au build — baked dans l'image
RUN wget -q "http://www.lexique.org/databases/Lexique383/Lexique383.tsv" -O lexique.tsv

COPY app.py .

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:5000/health || exit 1

CMD ["gunicorn", "-w", "2", "--timeout", "30", "-b", "0.0.0.0:5000", "app:app"]
