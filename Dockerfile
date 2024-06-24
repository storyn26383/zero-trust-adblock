FROM node:22-alpine

MAINTAINER Sasaya <sasaya@percussion.life>

COPY ./src ./src
COPY ./package.json ./package.json
COPY ./tsconfig.json ./tsconfig.json
COPY ./yarn.lock ./yarn.lock

RUN yarn install

CMD ["npx", "tsx", "src/index.ts"]
