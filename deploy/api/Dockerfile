FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Lexique 3.83, téléchargé au build et vérifié : un fichier altéré ou tronqué fait échouer le build
ARG LEXIQUE_SHA256=637ba37a767a66679c48371d673ece50cbf541b49a4e40e598963d4f3fbce52b
RUN wget -q "https://www.lexique.org/databases/Lexique383/Lexique383.tsv" -O lexique.tsv \
    && echo "${LEXIQUE_SHA256}  lexique.tsv" | sha256sum -c -

COPY *.py .

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:5000/health || exit 1

# --preload : Lexique est chargé une fois, avant que les 2 workers ne soient créés (ils le partagent)
CMD ["gunicorn", "-w", "2", "--timeout", "30", "--preload", "-b", "0.0.0.0:5000", "app:app"]
