# syntax=docker/dockerfile:1.4
FROM node:lts-slim AS development

LABEL org.opencontainers.image.source=https://github.com/toku-group/automerge-repo-sync-server
LABEL org.opencontainers.image.description="An implementation of automerge-repo-sync-server"
LABEL org.opencontainers.image.licenses=MIT

# Create app directory
WORKDIR /usr/src/app

COPY package.json ./package.json
RUN npm install

COPY . .
EXPOSE 3030
# NODE_ENV=dev DEBUG=* node ./src/index.js
ENV NODE_ENV=dev
ENV DEBUG=*
CMD [ "node", "./src/index.js" ]

FROM development AS dev-envs
RUN <<EOF
apt-get update
apt-get install -y --no-install-recommends git
EOF

RUN <<EOF
useradd -s /bin/bash -m vscode
groupadd docker
usermod -aG docker vscode
EOF

HEALTHCHECK CMD curl --fail http://localhost:3030 || exit 1

# install Docker tools (cli, buildx, compose)
# COPY --from=gloursdocker/docker / /

CMD [ "node", "./src/index.js" ]