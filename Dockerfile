FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY samples/partitura-ejemplo.pdf ./samples/partitura-ejemplo.pdf
COPY test ./test
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["node", "src/server.js"]
