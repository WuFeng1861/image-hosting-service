import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('images')
export class Image {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column({ length: 255 })
  filename: string;
  
  @Column({ name: 'original_name', length: 255 })
  originalName: string;
  
  @Column({ name: 'mime_type', length: 100 })
  mimeType: string;
  
  @Column({ type: 'int' })
  size: number;
  
  @Column({ length: 500 })
  url: string;
  
  @Column({ name: 'file_hash', length: 64, unique: true })
  fileHash: string;
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
