FROM node:22-alpine
WORKDIR /app

COPY package*.json .
RUN npm i
RUN npm i -g pm2

COPY . .
RUN npm run build

CMD [ "pm2-runtime", "ecosystem.config.js"]
