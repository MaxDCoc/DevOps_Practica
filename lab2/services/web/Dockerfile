FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
# Sin este flag, 15-local-resolvers.envsh no exporta NGINX_LOCAL_RESOLVERS y
# envsubst deja el "${...}" literal en el resolver de la config (nginx no arranca).
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
