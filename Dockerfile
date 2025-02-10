FROM node:22-alpine as builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --omit-dev
COPY . .
RUN npm run build

FROM node:22-alpine as runner
WORKDIR /app
RUN npm i -g pm2
COPY --from=builder /build/dist ./dist
COPY package.json ./

CMD [ "npm", "run", "start"]
