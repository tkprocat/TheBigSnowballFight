# The Big Snowball Fight has no dependencies, so the image is just Node and the game files.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json server.js rooms.js ./
COPY modes ./modes
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
