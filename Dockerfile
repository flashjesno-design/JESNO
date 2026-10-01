# ── Étape 1 : installation des dépendances ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts : better-sqlite3 embarque ses binaires précompilés, aucune compilation n'est nécessaire.
RUN npm ci --omit=dev --ignore-scripts

# ── Étape 2 : image finale ──
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY seed ./seed
COPY scripts ./scripts
COPY docs ./docs
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
