import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 11 })
  public_id: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  title: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'text', nullable: true })
  error_reason: string | null;

  @Column({ type: 'float', nullable: true })
  duration: number | null;

  @Column({ type: 'bigint', nullable: true })
  size_bytes: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mimetype: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  original_filename: string | null;

  @Column({ type: 'varchar', length: 512 })
  storage_key: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upload_id: string | null;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel, { nullable: false })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
