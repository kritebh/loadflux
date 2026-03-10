---
sidebar_position: 4
---

# NestJS Setup

NestJS works automatically with LoadFlux — no dedicated adapter needed. Since NestJS uses Express or Fastify under the hood, you use the corresponding LoadFlux function.

## NestJS with Express (default)

```typescript
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadflux } from "loadflux";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(loadflux({
    path: "/loadflux",
    auth: {
      username: process.env.LOADFLUX_USERNAME || "admin",
      password: process.env.LOADFLUX_PASSWORD || "password",
    },
  }));

  await app.listen(3000);
  console.log("Dashboard at http://localhost:3000/loadflux");
}

bootstrap();
```

## NestJS with Fastify

```typescript
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { loadfluxFastify } from "loadflux";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.register(loadfluxFastify({
    auth: {
      username: process.env.LOADFLUX_USERNAME || "admin",
      password: process.env.LOADFLUX_PASSWORD || "password",
    },
  }));

  await app.listen(3000);
}

bootstrap();
```

## Notes

- LoadFlux will automatically monitor all NestJS controller routes
- Route patterns from NestJS decorators (`@Get(':id')`, etc.) are resolved correctly
- Place the `loadflux()` middleware call before your route handlers for accurate timing
