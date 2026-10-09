FROM node:22-alpine
WORKDIR /app
RUN npm install --no-audit --no-fund @stellar/stellar-sdk@16.3.1
COPY infra/mock-backend.mjs ./
EXPOSE 4000
CMD ["node", "mock-backend.mjs"]
