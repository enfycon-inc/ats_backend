import { Module } from '@nestjs/common';
import { ResumeStorageService } from './resume-storage.service';
@Module({ providers: [ResumeStorageService], exports: [ResumeStorageService] })
export class ResumeStorageModule {}
