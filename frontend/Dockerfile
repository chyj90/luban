# ============================================================
# Stage 1: Build the Vite frontend
# ============================================================
FROM node:22-alpine AS build

WORKDIR /build

# Copy package files first for dependency caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npx vite build

# ============================================================
# Stage 2: Serve with Nginx
# ============================================================
FROM nginx:1.27-alpine

# Copy built static files
COPY --from=build /build/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create SSL directory for optional HTTPS cert mount
RUN mkdir -p /etc/nginx/ssl

# Entrypoint: dynamically enable HTTPS if certs are mounted
COPY docker-entrypoint.sh /docker-entrypoint.d/99-https.sh
RUN chmod +x /docker-entrypoint.d/99-https.sh

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]