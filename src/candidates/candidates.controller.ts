import { Controller, Get, Post, Delete, Body, Query, Param, ParseIntPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CandidatesService } from './candidates.service';
import { CreateCandidateDto } from './dtos/create-candidate.dto';
import { CandidateQueryDto } from './dtos/candidate-query.dto';
import { CandidateProfile } from './interfaces/candidate.interface';

@ApiTags('ATS Candidate Management')
@Controller('api/candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Directly Create & Import Candidate Profile',
    description: 'Executes a safe transaction creating candidate records and resume strings in Supabase.',
  })
  @ApiResponse({
    status: 201,
    description: 'Candidate profile and resume record created successfully in the shared database.',
  })
  async create(@Body() dto: CreateCandidateDto): Promise<CandidateProfile> {
    return this.candidatesService.createCandidate(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Retrieve List of Candidate Profiles',
    description: 'Lists candidates with optional filters, pagination, and full text keyword scans across profiles.',
  })
  @ApiResponse({
    status: 200,
    description: 'Candidate profiles fetched successfully.',
  })
  async findAll(@Query() query: CandidateQueryDto): Promise<CandidateProfile[]> {
    return this.candidatesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Detailed Candidate Profile by ID',
    description: 'Pulls a candidate profile and joins their complete resume and parsed details.',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Candidate detail fetched successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'The candidate profile with the specified database ID was not found.',
  })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<CandidateProfile> {
    return this.candidatesService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Candidate Profile by ID',
    description: 'Removes the candidate record and all joined work histories, education, skills, and resume attachments.',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Candidate profile and its linkages deleted successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'Candidate not found.',
  })
  async delete(@Param('id', ParseIntPipe) id: number): Promise<{ message: string }> {
    return this.candidatesService.deleteCandidate(id);
  }
}
