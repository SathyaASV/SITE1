FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production DB_PATH=/data/submissions.db PORT=3000
EXPOSE 3000
CMD ["node","--no-warnings","server.js"]
