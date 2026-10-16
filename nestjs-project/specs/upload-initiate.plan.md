---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.3
target_file: nestjs-project/test/videos-upload-initiate.e2e-spec.ts
---

# Upload Initiate (POST /videos) Test Plan

## Application Overview

The upload initiate endpoint creates a new video as a draft, starts an S3 multipart upload via `CreateMultipartUploadCommand`, and returns the video metadata (id, public_id, status). It requires authentication and ownership of the target channel.

## Test Scenarios

### 1. Successful Upload Initiation

**Setup:** Clean video table; create a test user with a channel; obtain JWT access token.

#### 1.1. create-video-as-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos with valid payload (filename, mimetype video/mp4, size 1048576, channel_id of owned channel) and Bearer token
    - expect: 201 status
    - expect: response body contains `public_id` with exactly 11 characters
    - expect: response body contains `status` equal to `"draft"`
    - expect: response body contains `id` as a valid UUID

### 2. Authentication Failures

**Setup:** Same as group 1 but vary authorization header.

#### 2.1. reject-without-auth-token

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos with valid body but without Authorization header
    - expect: 401 status

### 3. Authorization Failures

**Setup:** Create two users, each with a channel; obtain JWT for both.

#### 3.1. reject-non-owner-channel

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos with channel_id belonging to user B, using token of user A
    - expect: 403 status
    - expect: response body errorCode equals `"NOT_CHANNEL_OWNER"`

### 4. Validation Failures

**Setup:** Same as group 1.

#### 4.1. reject-size-exceeding-limit

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos with size = 10737418241 (10 GiB + 1 byte), valid token and channel_id
    - expect: 400 status
    - expect: response body indicates validation error on size field
