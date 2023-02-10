FROM  node:latest
COPY drand.js /opt/bot/drand.js
COPY group.js /opt/bot/group.js
COPY index.js /opt/bot/index.js
COPY shuffle.js /opt/bot/shuffle.js
COPY package.json /opt/bot/package.json
WORKDIR /opt/bot
RUN npm install
CMD ["/usr/local/bin/node", "index.js"]
