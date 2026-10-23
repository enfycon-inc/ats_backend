import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors, BadRequestException, HttpCode, HttpStatus, Header } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicJobsService } from './public-jobs.service';
import { CareerOauthService } from './career-oauth.service';
import { PublicJobsKeyGuard } from './public-jobs-key.guard';

@ApiTags('Public Career Site API Key Management')
@Controller('api/public-jobs/keys')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PublicJobsKeyController {
  constructor(private readonly service: PublicJobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an expiring, scoped career-site API key (secret is returned once)' })
  create(@CurrentUser() user: any, @Body() body: any) { return this.service.createKey(user, body); }

  @Get()
  @ApiOperation({ summary: 'List key metadata for the current tenant' })
  list(@CurrentUser() user: any) { return this.service.listKeys(user); }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a career-site API key immediately' })
  revoke(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.service.revokeKey(user, id); }
}

@ApiTags('Public Career Site Jobs API')
@Controller('api/public/jobs')
@UseGuards(PublicJobsKeyGuard)
export class PublicJobsController {
  constructor(private readonly service: PublicJobsService) {}

  @Get()
  @ApiOperation({ summary: 'List published jobs within the API key scope' })
  list(@Req() req: any, @Query() query: any) { return this.service.listJobs(req.publicJobsKey, query); }

  @Get(':slug')
  @ApiOperation({ summary: 'Get one published job within the API key scope' })
  get(@Req() req: any, @Param('slug') slug: string) { return this.service.getJob(req.publicJobsKey, slug); }

  @Post(':slug/applications')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  @ApiOperation({ summary: 'Submit a candidate application and resume for a published job' })
  apply(@Req() req: any, @Param('slug') slug: string, @Body() body: any, @UploadedFile() resume: any) {
    return this.service.apply(req.publicJobsKey, slug, body, resume);
  }
}

@ApiTags('Job Publication')
@Controller('api/jobs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JobPublicationController {
  constructor(private readonly service: PublicJobsService) {}

  @Patch(':id/publication')
  @ApiOperation({ summary: 'Publish or unpublish an active, approved job on the public career site' })
  publish(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    if (typeof body?.published !== 'boolean') throw new BadRequestException('published must be true or false.');
    return this.service.setPublished(user, id, body.published, body.publicDescription);
  }
}

@Controller('api/developer/clients')
@UseGuards(JwtAuthGuard)
export class CareerOauthClientController {
 constructor(private readonly oauth: CareerOauthService) {}
 @Post() create(@CurrentUser() user: any, @Body() body: any) { return this.oauth.create(user, body); }
 @Get() list(@CurrentUser() user: any) { return this.oauth.list(user); }
 @Delete(':id') revoke(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) { return this.oauth.revoke(user, id); }
}
@Controller('api/oauth')
export class CareerOauthTokenController {
 constructor(private readonly oauth: CareerOauthService) {}
 @Post('token')
 @HttpCode(200)
 @Header('Cache-Control', 'no-store')
 @Header('Pragma', 'no-cache')
 token(@Headers('authorization') authorization: string, @Body() body: any) { return this.oauth.token(authorization, body); }
}
