# ============================================================
# Stage 1: Build the Spring Boot application with Maven
# ============================================================
FROM maven:3.9-eclipse-temurin-21-alpine AS build

WORKDIR /build

# Copy pom.xml first for dependency caching
COPY pom.xml .
# Download dependencies (this layer is cached unless pom.xml changes)
RUN mvn dependency:go-offline -B -q || true

# Copy source code
COPY src ./src
COPY org ./org

# Build the fat jar (skip tests for Docker build)
RUN mvn package -DskipTests -B -q

# ============================================================
# Stage 2: Runtime
# ============================================================
FROM eclipse-temurin:21-jre-alpine

# Install netcat for MySQL health check in entrypoint
RUN apk add --no-cache netcat-openbsd openssl

RUN addgroup -S luban && adduser -S luban -G luban

WORKDIR /app

# Copy the built jar
COPY --from=build /build/target/*.jar app.jar

# Copy entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Copy algorithms directory (Python scripts used by the orchestration engine)
COPY algorithms ./algorithms

# Copy driver jars
COPY drivers ./drivers

USER luban

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]