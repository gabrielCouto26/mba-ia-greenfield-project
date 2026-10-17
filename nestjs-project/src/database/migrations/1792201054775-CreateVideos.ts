import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1792201054775 implements MigrationInterface {
  name = 'CreateVideos1792201054775';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying(11) NOT NULL, "title" character varying(255) NOT NULL DEFAULT '', "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "error_reason" text, "duration" double precision, "size_bytes" bigint, "mimetype" character varying(100), "original_filename" character varying(255), "storage_key" character varying(512) NOT NULL, "thumbnail_key" character varying(512), "upload_id" character varying(255), "channel_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_39a1f0fe7991162aace659078e" ON "videos" ("public_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39a1f0fe7991162aace659078e"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
