import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './interfaces/auth-user.interface';
import type { ProfileDetailsInput, SignatureInput, SignatureDefaultsInput } from './profile-contract';
import { StaffProfileService } from './services/staff-profile.service';
import { AuthService } from './auth.service';

@ApiTags('My profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/auth/me')
export class StaffProfileController {
  constructor(private readonly profiles: StaffProfileService, private readonly auth: AuthService) {}

  @Patch('details')
  async saveDetails(@CurrentUser() actor: AuthUser, @Body() input: ProfileDetailsInput) {
    await this.profiles.saveDetails(actor, input);
    return this.auth.getProfile(actor.dbId, actor);
  }
  @Post('photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async savePhoto(@CurrentUser() actor: AuthUser, @UploadedFile() file: { buffer: Buffer; size: number }) {
    await this.profiles.savePhoto(actor, file);
    return this.auth.getProfile(actor.dbId, actor);
  }
  @Delete('photo')
  async removePhoto(@CurrentUser() actor: AuthUser) {
    await this.profiles.removePhoto(actor);
    return this.auth.getProfile(actor.dbId, actor);
  }

  @Get('photos/:id')
  async photo(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    const data = await this.profiles.photo(actor, id);
    response.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    response.send(data);
  }
  @Get('signatures')
  signatures(@CurrentUser() actor: AuthUser) { return this.profiles.signatures(actor); }
  @Post('signatures/preview')
  preview(@Body() input: { html: string }) { return this.profiles.preview(input?.html); }
  @Post('signatures')
  saveSignature(@CurrentUser() actor: AuthUser, @Body() input: SignatureInput) { return this.profiles.saveSignature(actor, input); }
  @Patch('signatures/defaults')
  defaults(@CurrentUser() actor: AuthUser, @Body() input: SignatureDefaultsInput) { return this.profiles.saveDefaults(actor, input); }
  @Delete('signatures/:id')
  deleteSignature(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.profiles.deleteSignature(actor, id); }
}
