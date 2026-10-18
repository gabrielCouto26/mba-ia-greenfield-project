import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class PartDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;

  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PartDto)
  parts: PartDto[];
}
