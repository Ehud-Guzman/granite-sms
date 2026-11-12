# Production image for the API.
# Build: docker build -t granite-api ./server
# Run:   docker run -e DATABASE_URL=... -e JWT_SECRET=... -p 5000:5000 granite-api
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first (cached unless package files change). The Prisma CLI is a
# devDependency but is needed to apply migrations at start, so install it too.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save prisma@6.19.3 && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate

COPY index.js ./
COPY src ./src
COPY scripts ./scripts

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-5000}/health/ready || exit 1

# Apply pending migrations, then start. migrate deploy never prompts.
CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]
