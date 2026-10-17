import { IsInt, Max, Min } from 'class-validator';

export class PresignPartDto {
  /** 1-based part index (S3 multipart part number, 1–10000). */
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;
}
