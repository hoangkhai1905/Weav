# syntax=docker/dockerfile:1
# Production image (X-16). Build context: this service folder.
#   docker build --build-context workflow-schema=../../packages/workflow-schema -t weav-workflow -f Dockerfile .
# The workflow-schema build context supplies the node config schemas packaged into the jar.
# Dev uses Dockerfile.dev (mvnw spring-boot:run); this file is not used by compose.dev.yml.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /build

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw

COPY src/ src/
# Node config schemas are packaged as classpath resources (pom.xml: ../../packages/workflow-schema/nodes).
COPY --from=workflow-schema . /packages/workflow-schema/
# -Dmaven.test.skip skips test compilation too (tests need ../../packages/contracts, not the image).
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -q -Dmaven.test.skip=true package \
    && cp target/*.jar /build/app.jar

FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=build /build/app.jar /app/app.jar

USER 10001
EXPOSE 8080

# busybox wget ships in the alpine JRE image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
