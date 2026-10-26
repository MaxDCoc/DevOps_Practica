# Dashboard de la demo: se compila con Node y se sirve con nginx, que además hace de proxy
# hacia la API (/api) y hacia Jaeger (/jaeger) para que el navegador no tenga problemas de CORS.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
