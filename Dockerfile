FROM node:18-alpine

WORKDIR /app

# Install dependencies first to optimize build cache
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate

# Copy the rest of the source code
COPY . .

EXPOSE 5000

# Start NestJS with generated Prisma client
CMD ["sh", "-c", "npx prisma generate && npm run start:dev"]
