FROM node:12-buster

WORKDIR /home/node/app
COPY . .
RUN chown -R node:node .

USER node
RUN npm install --production

ARG LOGGER_TYPE=monitored_connect.js
ENV LOGGER_TYPE ${LOGGER_TYPE}

CMD node ${LOGGER_TYPE} "/home/node/app/configfile/config.toml"
VOLUME /home/node/app/configfile/
