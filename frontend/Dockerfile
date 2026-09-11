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

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]