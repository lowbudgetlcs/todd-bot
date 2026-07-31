FROM node:22-alpine AS builder
WORKDIR /build
COPY package*.json ./
# Full install: the build needs devDependencies (tsup is the bundler run by
# `npm run build`). Do NOT change this to --omit=dev — that drops tsup and the
# build fails.
RUN npm ci
COPY . .
RUN npm run build
# Now that dist/ is built, drop devDependencies so the runner stage copies a
# production-only node_modules instead of shipping tsup/eslint/vitest to prod.
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
RUN npm i -g pm2
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY package.json ./

CMD [ "npm", "run", "start"]
