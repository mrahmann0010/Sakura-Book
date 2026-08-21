import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminPreOrderBookUpsertRequestSchema,
  type AdminPreOrderBookList,
  type PreOrderBook,
} from "@sakura/contracts";
import { createZodDto } from "nestjs-zod";
import { AdminPreOrderBooksService } from "./admin-pre-order-books.service";

class AdminPreOrderBookUpsertDto extends createZodDto(adminPreOrderBookUpsertRequestSchema) {}

/**
 * Staff CRUD over the pre-order book. Authenticated by AdminJwtGuard, which
 * applies globally to every `admin/...` controller — see that guard's docs.
 * No `@Roles` restriction: like most of AdminOrdersController, editing the
 * pre-order listing is ordinary staff work, not an ADMIN-only one.
 */
@ApiTags("admin-pre-order-books")
@Controller("admin/pre-order-books")
export class AdminPreOrderBooksController {
  constructor(private readonly adminPreOrderBooksService: AdminPreOrderBooksService) {}

  @Get()
  @ApiOperation({ summary: "List every pre-order book, active or not." })
  async list(): Promise<AdminPreOrderBookList> {
    return this.adminPreOrderBooksService.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a pre-order book." })
  async create(@Body() body: AdminPreOrderBookUpsertDto): Promise<PreOrderBook> {
    return this.adminPreOrderBooksService.create(body);
  }

  @Put(":id")
  @ApiOperation({ summary: "Replace a pre-order book's fields." })
  async update(
    @Param("id") id: string,
    @Body() body: AdminPreOrderBookUpsertDto,
  ): Promise<PreOrderBook> {
    return this.adminPreOrderBooksService.update(id, body);
  }
}
