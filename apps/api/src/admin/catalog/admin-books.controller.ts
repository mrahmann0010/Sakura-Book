import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminBookCreateRequestSchema,
  adminBookQuerySchema,
  adminBookUpdateRequestSchema,
  type AdminBookDetail,
  type AdminBookList,
} from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import { AdminBooksService } from "./admin-books.service";

class AdminBookQueryDto extends createZodDto(adminBookQuerySchema) {}
class AdminBookCreateDto extends createZodDto(adminBookCreateRequestSchema) {}
class AdminBookUpdateDto extends createZodDto(adminBookUpdateRequestSchema) {}

/**
 * The catalog, admin side.
 *
 * No `@Roles` anywhere — any signed-in admin, STAFF included, matching
 * `admin-pre-order-books.controller.ts`'s precedent: managing what the shop
 * sells is day-to-day catalog work, not the money-moving action ADMIN is
 * reserved for on the orders controller.
 *
 * No DELETE route. See AdminBooksService for why — a book that has ever sold
 * is referenced by `order_items`, so deactivation (`PATCH` with
 * `isActive: false`) is the only removal path.
 */
@ApiTags("admin-catalog")
@Controller("admin/books")
export class AdminBooksController {
  constructor(private readonly booksService: AdminBooksService) {}

  @Get()
  @ApiOperation({ summary: "Browse the catalog: filter by text, active, featured." })
  async list(@Query() query: AdminBookQueryDto): Promise<AdminBookList> {
    return this.booksService.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Full book detail, including the fields the storefront hides." })
  async detail(@Param("id") id: string): Promise<AdminBookDetail> {
    return this.booksService.detail(id);
  }

  @Post()
  @ApiOperation({ summary: "Create a book. Authors/publisher are find-or-created by name." })
  async create(
    @Body() body: AdminBookCreateDto,
    @CurrentAdmin() admin: AccessClaims,
  ): Promise<AdminBookDetail> {
    return this.booksService.create(body, { sub: admin.sub, email: admin.email });
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a book. Omitted fields are left unchanged." })
  async update(
    @Param("id") id: string,
    @Body() body: AdminBookUpdateDto,
    @CurrentAdmin() admin: AccessClaims,
  ): Promise<AdminBookDetail> {
    return this.booksService.update(id, body, { sub: admin.sub, email: admin.email });
  }
}
