FROM node:16-bullseye
RUN apt-get update && apt-get install python3
WORKDIR /door-control
COPY ./package.json ./yarn.lock ./
RUN yarn install
COPY . .

ENTRYPOINT [ "node", "main.js" ]