FROM node:18-alpine

WORKDIR /app

# Install dependencies first to optimize build cache
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

EXPOSE 5000

# Start NestJS in watching development mode (compiles on file save)
CMD ["npm", "run", "start:dev"]
