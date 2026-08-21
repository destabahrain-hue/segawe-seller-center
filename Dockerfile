# Dockerfile sederhana yang terbukti jalan di Railway.
# JANGAN andalkan auto-detect Railpack/Nixpacks — di proyek lalu keduanya gagal.
FROM node:20-slim

WORKDIR /app

# package-lock.json sengaja TIDAK disertakan di repo.
# Lockfile lama pernah mengunci next versi rentan dan bikin Railway menolak build.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "run", "start"]
