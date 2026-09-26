import * as dotenv from 'dotenv';
// Load .env for native (non-Docker) local runs. In Docker, env_file already
// injects these vars, and dotenv is a harmless no-op if the file is absent.
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as dns from 'node:dns';
import * as express from 'express';
import { logoDirectory, LOGO_URL_PREFIX } from './auth/utils/logo-storage';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS so the recruiter dashboard front-end can communicate with backend endpoints
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-branch-id', 'x-custom-tenant-domain', 'x-tenant-domain'],
  });
  
  // Increase payload limit for large CSV uploads (mass mail)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(LOGO_URL_PREFIX, express.static(logoDirectory(), {
    dotfiles: 'deny', index: false, maxAge: '1y', immutable: true,
    setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); },
  }));

  // Configure Swagger OpenAPI document metadata
  const config = new DocumentBuilder()
    .setTitle('ATS Sourcing & Core API')
    .setDescription(
      'The Applicant Tracking System (ATS) core REST backend containing candidate management, talent sourcing, and partner integrations (Dice / Monster).',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Talent Sourcing & Job Board Integrations')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Expose interactive Swagger client UI docs at /docs
  SwaggerModule.setup('docs', app, document);

  // Bind to port 5000 as configured in docker-compose.yml
  const port = process.env.PORT ?? 5000;
  await app.listen(port, '0.0.0.0');
  
  console.log(`[ATS BACKEND] NestJS Core API server started on port ${port}`);
  console.log(`[ATS BACKEND] Swagger UI Documentation available at http://localhost:${port}/docs`);
}
bootstrap();
