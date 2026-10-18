import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from '../dto/complete-upload.dto';
import { CreateVideoDto } from '../dto/create-video.dto';
import { PresignPartDto } from '../dto/presign-part.dto';
import { VideosService } from '../services/videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate video upload',
    description:
      'Creates a draft video record and initiates an S3 multipart upload. Returns the video id, public_id, and status.',
  })
  @ApiResponse({
    status: 201,
    description: 'Video draft created and multipart upload initiated',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        public_id: { type: 'string', minLength: 11, maxLength: 11 },
        status: { type: 'string', example: 'draft' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(@Body() dto: CreateVideoDto, @CurrentUser() user: JwtPayload) {
    return this.videosService.create(dto, user.sub);
  }

  @Post(':publicId/upload/presign-part')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Presign upload part',
    description:
      'Generates a presigned URL for uploading a specific part to S3/MinIO.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned URL generated',
    schema: {
      properties: {
        presigned_url: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'No active multipart upload for this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async presignPart(
    @Param('publicId') publicId: string,
    @Body() dto: PresignPartDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videosService.presignPart(publicId, dto.part_number, user.sub);
  }

  @Post(':publicId/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete multipart upload',
    description:
      'Finalizes the S3 multipart upload, transitions the video to processing, and enqueues a processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed — video is now processing',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        public_id: { type: 'string' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'No active multipart upload for this video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.videosService.completeUpload(publicId, dto.parts, user.sub);
  }

  @Post(':publicId/upload/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abort multipart upload',
    description:
      'Cancels an in-progress multipart upload and clears the upload_id.',
  })
  @ApiResponse({ status: 204, description: 'Upload aborted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abortUpload(
    @Param('publicId') publicId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.videosService.abortUpload(publicId, user.sub);
  }

  @Get(':publicId')
  @Public()
  @ApiOperation({
    summary: 'Get video info',
    description:
      'Returns public metadata for a video, including a presigned thumbnail URL when available.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video metadata',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        public_id: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        duration: { type: 'number', nullable: true },
        thumbnail_url: { type: 'string', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideoInfo(@Param('publicId') publicId: string) {
    return this.videosService.findByPublicId(publicId);
  }

  @Get(':publicId/stream')
  @Redirect('', HttpStatus.FOUND)
  @Public()
  @ApiOperation({
    summary: 'Stream video',
    description: 'Redirects to a presigned S3 URL for video streaming.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to presigned S3 GET URL for streaming',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(@Param('publicId') publicId: string) {
    const url = await this.videosService.getStreamUrl(publicId);
    return { url };
  }

  @Get(':publicId/download')
  @Redirect('', HttpStatus.FOUND)
  @Public()
  @ApiOperation({
    summary: 'Download video',
    description:
      'Redirects to a presigned S3 URL for video download with Content-Disposition attachment.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to presigned S3 GET URL for download',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(@Param('publicId') publicId: string) {
    const url = await this.videosService.getDownloadUrl(publicId);
    return { url };
  }
}
