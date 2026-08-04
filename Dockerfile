FROM node:20-bookworm-slim

WORKDIR /app

# PM2'nin konteynerler icin tasarlanmis giris noktasi pm2-runtime'dir.
RUN npm install --global pm2@6

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p /data /app/logs /app/firmware-files \
    && chown -R node:node /data /app/logs /app/firmware-files

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    MQTT_PORT=1883 \
    WEB_PORT=3000 \
    SECURITY_DB_PATH=/data/security.sqlite3

EXPOSE 1883 3000 3443 8883

USER node

VOLUME ["/data", "/app/logs", "/app/firmware-files"]

CMD ["pm2-runtime", "ecosystem.config.cjs"]
