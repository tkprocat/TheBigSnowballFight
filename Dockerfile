# The Big Snowball Fight has no dependencies, so the image is just Node and the game files.
FROM node:24-alpine
WORKDIR /app
# Anonymous statistics go to /data/stats.jsonl: mount a volume there to keep them across updates.
# The admin dashboard at /admin stays off until you set ADMIN_TOKEN.
ENV NODE_ENV=production PORT=3000 STATS_DIR=/data
COPY package.json server.js rooms.js stats.js admin.js ./
COPY modes ./modes
COPY admin ./admin
COPY public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
