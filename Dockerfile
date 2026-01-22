# ---------- Frontend build ----------
FROM node:20-alpine AS frontend-build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---------- Backend runtime ----------
FROM node:20-alpine
WORKDIR /app

# Install Chromium for Puppeteer (Alpine)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Puppeteer: don't download Chromium; use system Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY server/package*.json ./server/
RUN cd server && npm ci

COPY server ./server

# ✅ This will now work because the stage exists
COPY --from=frontend-build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
