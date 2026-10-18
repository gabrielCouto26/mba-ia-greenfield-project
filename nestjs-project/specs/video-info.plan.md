---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: nestjs-project/test/videos-info.e2e-spec.ts
---

# Video Info (GET /videos/:publicId) Test Plan

## Application Overview

The video info endpoint returns metadata for a single video by its public_id, including a presigned thumbnail URL when available. It is a public endpoint (no auth required) and returns all fields defined in the API contract.

## Test Scenarios

### 1. Successful Retrieval

**Setup:** Clean video table; create a video with status `ready`, populated duration, and a thumbnail_key pointing to an object in MinIO.

#### 1.1. return-video-with-all-fields

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId (no auth required)
    - expect: 200 status
    - expect: response body contains `id`, `public_id`, `title`, `status`, `duration`, `thumbnail_url`, `created_at`
    - expect: all fields match the values in DB

#### 1.2. return-thumbnail-as-presigned-url

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId for video with thumbnail_key set
    - expect: 200 status
    - expect: `thumbnail_url` is a presigned URL string pointing to MinIO

### 2. Video Without Thumbnail

**Setup:** Create a video with thumbnail_key = null.

#### 2.1. return-null-thumbnail-when-absent

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId for video without thumbnail
    - expect: 200 status
    - expect: `thumbnail_url` is null

### 3. Not Found

**Setup:** No video with given publicId.

#### 3.1. return-404-for-missing-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/nonexistent1
    - expect: 404 status
    - expect: response body errorCode equals `"VIDEO_NOT_FOUND"`
