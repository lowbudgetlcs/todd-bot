FROM node:22-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --omit-dev
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN npm i -g pm2
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY package.json ./

CMD [ "npm", "run", "start"]
