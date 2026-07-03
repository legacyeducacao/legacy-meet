# Worker de transcrição do Legacy Meet (Node + ffmpeg)
FROM node:20-slim

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY transcribe.ts tsconfig.json ./
COPY lib ./lib

# -u/unbuffered não se aplica ao node; logs já saem na hora
CMD ["npx", "tsx", "transcribe.ts"]
