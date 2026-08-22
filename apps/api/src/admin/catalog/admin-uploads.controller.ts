import { randomUUID } from "node:crypto";
import { Controller, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AdminUploadResult } from "@sakura/contracts";
import { InvalidInputError } from "../../common/errors";
import { StorageService } from "../../storage";

const COVER_MAX_BYTES = 8 * 1024 * 1024;
const PDF_MAX_BYTES = 40 * 1024 * 1024;

const COVER_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Cover image and sample-PDF uploads for the book form.
 *
 * No `FileInterceptor` `storage` option, so multer keeps the upload in memory
 * (`file.buffer`) rather than writing it to the container's disk — the file
 * exists only long enough to be forwarded to Supabase Storage, and this
 * process may not have a writable or persistent filesystem at all.
 *
 * Neither route is restricted by `@Roles` — same reasoning as
 * AdminBooksController, which is what these exist to serve.
 */
@ApiTags("admin-catalog")
@Controller("admin/uploads")
export class AdminUploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Post("cover")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload a book cover image (JPEG/PNG/WebP, max 8MB)." })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: COVER_MAX_BYTES } }))
  async uploadCover(@UploadedFile() file?: Express.Multer.File): Promise<AdminUploadResult> {
    if (!file) throw new InvalidInputError("No file was uploaded.");

    const extension = COVER_MIME_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new InvalidInputError("Cover images must be JPEG, PNG, or WebP.", {
        mimetype: file.mimetype,
      });
    }

    const uploaded = await this.storageService.upload(
      `covers/${randomUUID()}.${extension}`,
      file.buffer,
      file.mimetype,
    );

    return { url: uploaded.url };
  }

  @Post("pdf")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload a sample/preview PDF (max 40MB)." })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PDF_MAX_BYTES } }))
  async uploadPdf(@UploadedFile() file?: Express.Multer.File): Promise<AdminUploadResult> {
    if (!file) throw new InvalidInputError("No file was uploaded.");

    if (file.mimetype !== "application/pdf") {
      throw new InvalidInputError("Only PDF files are accepted.", { mimetype: file.mimetype });
    }

    const uploaded = await this.storageService.upload(
      `pdfs/${randomUUID()}.pdf`,
      file.buffer,
      file.mimetype,
    );

    return { url: uploaded.url, fileName: file.originalname };
  }
}
