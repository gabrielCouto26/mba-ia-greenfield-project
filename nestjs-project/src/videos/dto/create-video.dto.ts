import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVideoDto {
  /** Original file name */
  @IsString()
  @MaxLength(255)
  filename: string;

  /** Video MIME type, e.g. video/mp4 */
  @IsString()
  @Matches(/^video\//, { message: 'mimetype must match video/* pattern' })
  mimetype: string;

  /** Total file size in bytes (max 10 GiB) */
  @IsInt()
  @Min(1)
  @Max(10737418240)
  size: number;

  /** UUID of the channel to upload to */
  @IsUUID()
  channel_id: string;
}
