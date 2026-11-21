# Build context: repository root (the build reads the shared contracts/ schemas).
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY contracts/schemas contracts/schemas
COPY services/invoice-robot/pom.xml services/invoice-robot/pom.xml
RUN mvn -q -B -f services/invoice-robot/pom.xml dependency:go-offline
COPY services/invoice-robot/src services/invoice-robot/src
RUN mvn -q -B -f services/invoice-robot/pom.xml package -DskipTests

FROM eclipse-temurin:21-jre-noble
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=build /build/services/invoice-robot/target/invoice-robot-*.jar app.jar
# Install Chromium and its system dependencies with the Playwright CLI bundled in the app.
# The bundled Node driver needs libatomic before it can install anything else; curl serves the healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 curl \
    && java -cp app.jar -Dloader.main=com.microsoft.playwright.CLI \
      org.springframework.boot.loader.launch.PropertiesLauncher install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
