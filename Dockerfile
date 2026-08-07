FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY public ./public
COPY prompts ./prompts
COPY scripts/invite-beta-user.js ./scripts/invite-beta-user.js
USER node
EXPOSE 8138
CMD ["npm", "run", "start:web"]